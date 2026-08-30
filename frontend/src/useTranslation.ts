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
 * ── Чому запис крутиться завжди, а не вмикається на голос ───────────────────
 * Якщо починати запис у мить, коли рівень перескочив поріг, з'їдається початок
 * першого слова: і детектор, і сам MediaRecorder мають затримку. Тому рекордер
 * пишеться безперервно, а голос лише вирішує, ЩО з готовим файлом робити -
 * відправити чи викинути. Заодно це знімає стару пастку з timeslice: кожен
 * файл живе від start() до stop(), тобто має власний заголовок контейнера.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribeChunk } from './api'

export type TranscriptLine = { id: number; text: string; at: number }

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
  getStream: () => MediaStream | null,
  getLevel: () => number,
  enabled: boolean,
  maxTakeMs = 6000,
) {
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hearing, setHearing] = useState(false)
  const idRef = useRef(0)
  const inFlightRef = useRef(false)

  const push = useCallback((text: string) => {
    const clean = text.trim()
    if (!clean) return
    setLines(prev => {
      // Whisper любить повторити щойно сказане, коли наступна репліка почалась
      // тим самим словом або коли в дублі майже не було нової мови. Однаковий
      // рядок поспіль - завжди артефакт, а не двічі сказана фраза.
      const last = prev[prev.length - 1]
      if (last && last.text.toLowerCase() === clean.toLowerCase()) return prev
      return [...prev, { id: ++idRef.current, text: clean, at: Date.now() }].slice(-MAX_LINES)
    })
  }, [])

  useEffect(() => {
    if (!enabled) return

    const mime = pickMime()
    if (!mime) { setError('Браузер не вміє записувати звук для перекладу.'); return }

    let cancelled = false
    let rec: MediaRecorder | null = null
    let parts: Blob[] = []
    let startedAt = 0
    let speechMs = 0          // скільки в цьому дублі було справжньої мови
    let lastLoudAt = 0
    let inSpeech = false
    let tick: number | undefined
    let retry: number | undefined
    const ctrl = new AbortController()

    const send = async (blob: Blob) => {
      if (cancelled) return
      // Поки попередня репліка ще розпізнається, цю пропускаємо: розпізнавання
      // на сервері однопотокове, черга росла б швидше, ніж він встигає.
      if (inFlightRef.current) return
      inFlightRef.current = true
      setBusy(true)
      try {
        const out = await transcribeChunk(blob, ctrl.signal)
        if (!cancelled && out?.text) push(out.text)
        if (!cancelled && out) setError(null)
      } catch (err) {
        if (!cancelled && (err as Error).name !== 'AbortError') setError((err as Error).message)
      } finally {
        inFlightRef.current = false
        if (!cancelled) setBusy(false)
      }
    }

    // Закрити поточний файл і, якщо в ньому була мова, відправити.
    const cut = () => {
      const r = rec
      if (!r) return
      const hadSpeech = speechMs >= MIN_SPEECH_MS
      rec = null
      r.onstop = () => {
        const blob = new Blob(parts, { type: mime })
        parts = []
        if (hadSpeech && blob.size > 1200) void send(blob)
        if (!cancelled) open()
      }
      try { r.stop() } catch { if (!cancelled) open() }
    }

    const open = () => {
      if (cancelled) return
      const stream = getStream()
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
      const level = getLevel()
      const now = Date.now()

      if (inSpeech ? level > SPEECH_OFF : level > SPEECH_ON) {
        if (!inSpeech) { inSpeech = true; setHearing(true) }
        speechMs += LEVEL_TICK_MS
        lastLoudAt = now
      } else if (inSpeech) {
        inSpeech = false
        setHearing(false)
      }

      const age = now - startedAt
      // Репліка договорена: після мови настала пауза.
      if (speechMs >= MIN_SPEECH_MS && lastLoudAt && now - lastLoudAt >= HANG_MS) { cut(); return }
      // Довгий монолог без пауз усе одно ріжемо, щоб переклад не чекав кінця.
      if (speechMs >= MIN_SPEECH_MS && age >= maxTakeMs) { cut(); return }
      // Тиша: файл не тримаємо нескінченно, просто перезаписуємо.
      if (speechMs < MIN_SPEECH_MS && age >= IDLE_RECYCLE_MS) { cut(); return }
    }, LEVEL_TICK_MS)

    open()

    return () => {
      cancelled = true
      if (tick) window.clearInterval(tick)
      if (retry) window.clearTimeout(retry)
      ctrl.abort()
      const r = rec
      rec = null
      if (r) { r.onstop = null; try { r.stop() } catch { /* ignore */ } }
      parts = []
      inFlightRef.current = false
      setBusy(false)
      setHearing(false)
    }
  }, [enabled, getStream, getLevel, push, maxTakeMs])

  const clear = useCallback(() => setLines([]), [])

  return { lines, error, busy, hearing, clear }
}
