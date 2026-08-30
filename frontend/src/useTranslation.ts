/**
 * Переклад ефіру англійською.
 *
 * Голоси в кімнаті (чужі й власний мікрофон) зводяться в useVoice в одну
 * шину. Звідси беремо її потік, пишемо короткими дублями і кожен дубль
 * окремим запитом шлемо на /api/translation/transcribe, де faster-whisper
 * віддає англійський текст.
 *
 * Чому дублями по кілька секунд, а не одним записом: розпізнавання на
 * сервері однопотокове і тримає замок, тож довгий запис дав би переклад лише
 * в кінці розмови.
 *
 * ВАЖЛИВО про нарізку. Перша редакція викликала rec.start(CHUNK_MS) і брала
 * шматки з ondataavailable. Так робити не можна: timeslice ріже ОДИН
 * безперервний запис на фрагменти, і заголовок контейнера має лише перший
 * фрагмент. Другий і далі - хвости без заголовка, ffmpeg на боці whisper їх
 * не відкриває, сервер віддає 503, клієнт мовчки їх пропускає. Назовні це
 * виглядало як «переклад не працює»: у кращому разі один рядок і тиша.
 * Тому кожен дубль - окремий MediaRecorder від start() до stop(), тобто
 * самостійний повноцінний файл.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribeChunk } from './api'

export type TranscriptLine = { id: number; text: string; at: number }

const MAX_LINES = 40
// Бекенд тримає ліміт 24 запити за 60 секунд. Дубль на шість секунд дає до
// десяти запитів за хвилину - є запас. Найкоротший з доступних, чотири
// секунди, дає п'ятнадцять - теж у межах.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
// Поріг тиші. Рахуємо по хвилі, а не по розмірі файлу: розмір залежить від
// кодека й бітрейта, а RMS - ні. Піднятий з 0.006: на тиші Whisper не мовчить,
// а вигадує текст, і вигадку слухач не відрізнить від справжніх слів. Тобто
// зайвий дубль тиші коштує дорожче, ніж пропущена дуже тиха репліка.
const SILENCE_RMS = 0.02

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(m)) return m
  return null
}

export function useTranslation(
  getStream: () => MediaStream | null,
  getLevel: () => number,
  enabled: boolean,
  takeMs = 6000,
) {
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const idRef = useRef(0)
  const inFlightRef = useRef(false)

  const push = useCallback((text: string) => {
    const clean = text.trim()
    if (!clean) return
    setLines(prev => [...prev, { id: ++idRef.current, text: clean, at: Date.now() }].slice(-MAX_LINES))
  }, [])

  useEffect(() => {
    if (!enabled) return

    const mime = pickMime()
    if (!mime) { setError('Браузер не вміє записувати звук для перекладу.'); return }

    let cancelled = false
    let timer: number | undefined
    let rec: MediaRecorder | null = null
    let peak = 0
    let meter: number | undefined
    const ctrl = new AbortController()

    // Гучність міряємо аналізатором з useVoice, на тому самому AudioContext.
    // Свій окремий new AudioContext тут стояти НЕ повинен: зайвий аудіограф
    // поруч із відкритим мікрофоном - зайвий ризик на порожньому місці.
    meter = window.setInterval(() => {
      const rms = getLevel()
      if (rms > peak) peak = rms
    }, 120)

    const send = async (blob: Blob) => {
      if (cancelled || inFlightRef.current) return
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

    // Один дубль: почали запис, через TAKE_MS зупинили, зібрали цілий файл,
    // відправили і одразу почали наступний.
    const take = () => {
      if (cancelled) return
      const stream = getStream()
      if (!stream || !stream.getAudioTracks().length) { timer = window.setTimeout(take, 1200); return }
      peak = 0
      const parts: Blob[] = []
      try {
        rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 })
      } catch {
        setError('Не вдалося почати запис для перекладу.')
        return
      }
      rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data) }
      rec.onstop = () => {
        const loud = peak >= SILENCE_RMS
        const blob = new Blob(parts, { type: mime })
        // Поки попередній дубль ще в дорозі, цей пропускаємо: інакше черга
        // росте швидше, ніж сервер встигає розпізнавати.
        if (loud && blob.size > 1500 && !inFlightRef.current) void send(blob)
        take()
      }
      try { rec.start() } catch { setError('Не вдалося почати запис для перекладу.'); return }
      timer = window.setTimeout(() => { try { rec?.stop() } catch { /* ignore */ } }, takeMs)
    }

    take()

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      if (meter) window.clearInterval(meter)
      ctrl.abort()
      try { rec?.stop() } catch { /* ignore */ }
      rec = null
      inFlightRef.current = false
      setBusy(false)
    }
  }, [enabled, getStream, getLevel, push, takeMs])

  const clear = useCallback(() => setLines([]), [])

  return { lines, error, busy, clear }
}
