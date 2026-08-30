/**
 * Переклад ефіру англійською.
 *
 * Голоси співрозмовників зводяться в useVoice в одну шину. Звідси беремо її
 * потік, ріжемо на репліки і кожну окремим запитом шлемо на
 * /api/translation/transcribe, де faster-whisper віддає англійський текст.
 *
 * ── Чому ріжемо по паузах, а не по таймеру ──────────────────────────────────
 * Перша робоча версія брала дублі фіксованої довжини. Це давало найгіршу
 * можливу затримку: коротка репліка все одно чекала кінця свого шестисекундного
 * вікна, і тільки потім ішла на розпізнавання. Разом із розпізнаванням виходило
 * секунд вісім-дев'ять. Плюс вікно різало фразу там, де закінчився таймер, а не
 * там, де людина договорила - модель отримувала обрубок і псувала переклад.
 *
 * Тепер межа репліки - пауза в мові. Рівень на шині міряється безперервно; коли
 * після мови настала тиша довша за HANG_MS, репліка вважається закінченою і
 * одразу йде на сервер. Затримка стає «пауза + розпізнавання» замість «залишок
 * вікна + розпізнавання», а фраза приходить цілою.
 *
 * ── Чому кожен співрозмовник пишеться окремо ───────────────────────────────
 * Спершу всі голоси зводились в одну шину. У розмові вдвох це працює, а втрьох
 * і більше дає кашу: коли двоє заговорили разом, модель отримує накладені
 * голоси і видає з них одну зіпсовану фразу. І навіть коли говорять по черзі,
 * у стрічці не видно, хто що сказав, - для розмови кількох людей це половина
 * сенсу. Тому в кожного свій запис, свій детектор пауз і своя черга, а рядок
 * приходить із підписом.
 *
 * ── Чому запис крутиться завжди, а не вмикається на голос ───────────────────
 * Якщо починати запис у мить, коли рівень перескочив поріг, з'їдається початок
 * першого слова: і детектор, і сам MediaRecorder мають затримку. Тому рекордер
 * пишеться безперервно, а голос лише вирішує, ЩО з готовим файлом робити -
 * відправити чи викинути. Заодно це знімає стару пастку з timeslice: кожен
 * файл живе від start() до stop(), тобто має власний заголовок контейнера.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribeChunk } from './api'

export type TranscriptLine = { id: number; text: string; at: number; speaker: number }

const MAX_LINES = 40
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

// Поріг входу в мову і нижчий поріг виходу - щоб на межі не смикалось туди-сюди.
const SPEECH_ON = 0.022
const SPEECH_OFF = 0.012
// Пауза, після якої репліка вважається закінченою. Менше - швидше, але ріже на
// вдиху посеред речення; більше - цілісніше, але чекаєш довше.
const HANG_MS = 620
// Коротші уривки майже завжди клацання й кашель, а не мова.
const MIN_SPEECH_MS = 500
// Якщо мови немає, рекордер не тримає нескінченний файл у пам'яті.
const IDLE_RECYCLE_MS = 12000
const LEVEL_TICK_MS = 60

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(m)) return m
  return null
}

export function useTranslation(
  peers: number[],
  getStream: (id: number) => MediaStream | null,
  getLevel: (id: number) => number,
  enabled: boolean,
  room: string,
  maxTakeMs = 6000,
) {
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hearing, setHearing] = useState(false)
  const idRef = useRef(0)
  // Черга своя на кожного співрозмовника: поки розпізнається репліка одного,
  // другий не має мовчати.
  const inFlightRef = useRef<Set<number>>(new Set())
  const hearingRef = useRef<Set<number>>(new Set())

  const push = useCallback((speaker: number, text: string) => {
    const clean = text.trim()
    if (!clean) return
    setLines(prev => {
      // Whisper любить повторити щойно сказане. Однаковий рядок поспіль ВІД
      // ТОГО САМОГО мовця - артефакт; від іншого це може бути справжня згода.
      const last = prev[prev.length - 1]
      if (last && last.speaker === speaker && last.text.toLowerCase() === clean.toLowerCase()) return prev
      return [...prev, { id: ++idRef.current, text: clean, at: Date.now(), speaker }].slice(-MAX_LINES)
    })
  }, [])

  const peersKey = peers.join(',')

  useEffect(() => {
    if (!enabled || !peers.length) return

    const mime = pickMime()
    if (!mime) { setError('Браузер не вміє записувати звук для перекладу.'); return }

    let cancelled = false
    const stops: Array<() => void> = []

    const markBusy = () => { if (!cancelled) setBusy(inFlightRef.current.size > 0) }
    const markHearing = () => { if (!cancelled) setHearing(hearingRef.current.size > 0) }

    const send = async (speaker: number, blob: Blob, ctrl: AbortController) => {
      if (cancelled || inFlightRef.current.has(speaker)) return
      inFlightRef.current.add(speaker)
      markBusy()
      try {
        const out = await transcribeChunk(blob, room, speaker, ctrl.signal)
        if (!cancelled && out?.text) push(speaker, out.text)
        if (!cancelled && out) setError(null)
      } catch (err) {
        if (!cancelled && (err as Error).name !== 'AbortError') setError((err as Error).message)
      } finally {
        inFlightRef.current.delete(speaker)
        markBusy()
      }
    }

    // Один незалежний запис на одного співрозмовника.
    for (const speaker of peers) {
      let rec: MediaRecorder | null = null
      let parts: Blob[] = []
      let startedAt = 0
      let speechMs = 0
      let lastLoudAt = 0
      let inSpeech = false
      let tick: number | undefined
      let retry: number | undefined
      const ctrl = new AbortController()

      const cut = () => {
        const r = rec
        if (!r) return
        const hadSpeech = speechMs >= MIN_SPEECH_MS
        rec = null
        r.onstop = () => {
          const blob = new Blob(parts, { type: mime })
          parts = []
          if (hadSpeech && blob.size > 1200) void send(speaker, blob, ctrl)
          if (!cancelled) open()
        }
        try { r.stop() } catch { if (!cancelled) open() }
      }

      const open = () => {
        if (cancelled) return
        const stream = getStream(speaker)
        if (!stream || !stream.getAudioTracks().length) { retry = window.setTimeout(open, 800); return }
        try {
          rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 })
        } catch {
          setError('Не вдалося почати запис для перекладу.')
          return
        }
        parts = []
        startedAt = Date.now()
        speechMs = 0
        lastLoudAt = 0
        inSpeech = false
        rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data) }
        try { rec.start() } catch { setError('Не вдалося почати запис для перекладу.') }
      }

      tick = window.setInterval(() => {
        if (cancelled || !rec) return
        const level = getLevel(speaker)
        const now = Date.now()

        if (inSpeech ? level > SPEECH_OFF : level > SPEECH_ON) {
          if (!inSpeech) { inSpeech = true; hearingRef.current.add(speaker); markHearing() }
          speechMs += LEVEL_TICK_MS
          lastLoudAt = now
        } else if (inSpeech) {
          inSpeech = false
          hearingRef.current.delete(speaker)
          markHearing()
        }

        const age = now - startedAt
        if (speechMs >= MIN_SPEECH_MS && lastLoudAt && now - lastLoudAt >= HANG_MS) { cut(); return }
        if (speechMs >= MIN_SPEECH_MS && age >= maxTakeMs) { cut(); return }
        if (speechMs < MIN_SPEECH_MS && age >= IDLE_RECYCLE_MS) { cut(); return }
      }, LEVEL_TICK_MS)

      open()

      stops.push(() => {
        if (tick) window.clearInterval(tick)
        if (retry) window.clearTimeout(retry)
        ctrl.abort()
        const r = rec
        rec = null
        if (r) { r.onstop = null; try { r.stop() } catch { /* ignore */ } }
        parts = []
        inFlightRef.current.delete(speaker)
        hearingRef.current.delete(speaker)
      })
    }

    return () => {
      cancelled = true
      for (const stop of stops) stop()
      setBusy(false)
      setHearing(false)
    }
    // peersKey, а не peers: масив із тими самими учасниками не має
    // перезапускати всі записи.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, peersKey, getStream, getLevel, push, room, maxTakeMs])

  const clear = useCallback(() => setLines([]), [])

  return { lines, error, busy, hearing, clear }
}
