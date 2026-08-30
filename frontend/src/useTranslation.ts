/**
 * Переклад ефіру англійською.
 *
 * Голоси співрозмовників зводяться в useVoice в одну шину, звідси беремо її
 * потік і пишемо короткими шматками. Кожен шматок окремим запитом іде на
 * /api/translation/transcribe, де faster-whisper віддає англійський текст.
 *
 * Чому шматками, а не одним довгим записом: розпізнавання на сервері
 * однопотокове і тримає замок, тож довгий запис дав би переклад лише в кінці
 * розмови. Шість секунд - компроміс між затримкою і тим, щоб фраза не рвалася
 * посередині.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribeChunk } from './api'

export type TranscriptLine = { id: number; text: string; at: number }

const CHUNK_MS = 6000
const MAX_LINES = 40
// На бекенді ліміт 24 запити за 60 секунд. Шматок на шість секунд дає десять
// запитів за хвилину, тобто вдвічі менше стелі - є запас на повтори.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(m)) return m
  return null
}

export function useTranslation(getStream: () => MediaStream | null, enabled: boolean) {
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const idRef = useRef(0)
  const inFlightRef = useRef(false)

  const push = useCallback((text: string) => {
    const clean = text.trim()
    if (!clean) return
    setLines(prev => [...prev, { id: ++idRef.current, text: clean, at: Date.now() }].slice(-MAX_LINES))
  }, [])

  const stop = useCallback(() => {
    try { recorderRef.current?.stop() } catch { /* ignore */ }
    recorderRef.current = null
    abortRef.current?.abort()
    abortRef.current = null
    inFlightRef.current = false
    setBusy(false)
  }, [])

  useEffect(() => {
    if (!enabled) { stop(); return }

    const mime = pickMime()
    if (!mime) { setError('Браузер не вміє записувати звук для перекладу.'); return }

    let cancelled = false
    let timer: number | undefined

    const start = () => {
      const stream = getStream()
      // Шини ще немає, поки в кімнаті ніхто не говорив: чекаємо і пробуємо знову.
      if (!stream || !stream.getAudioTracks().length) {
        timer = window.setTimeout(start, 1200)
        return
      }
      setError(null)
      let rec: MediaRecorder
      try {
        rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 })
      } catch {
        setError('Не вдалося почати запис для перекладу.')
        return
      }
      recorderRef.current = rec

      rec.ondataavailable = async (e) => {
        if (cancelled || !e.data || e.data.size < 2000) return
        // Поки попередній шматок ще в дорозі, наступний пропускаємо: інакше
        // черга росте швидше, ніж сервер встигає розпізнавати.
        if (inFlightRef.current) return
        inFlightRef.current = true
        setBusy(true)
        const ctrl = new AbortController()
        abortRef.current = ctrl
        try {
          const out = await transcribeChunk(e.data, ctrl.signal)
          if (!cancelled && out?.text) push(out.text)
        } catch (err) {
          if (!cancelled && (err as Error).name !== 'AbortError') setError((err as Error).message)
        } finally {
          inFlightRef.current = false
          if (!cancelled) setBusy(false)
        }
      }
      // timeslice сам ріже запис на шматки потрібної довжини.
      try { rec.start(CHUNK_MS) } catch { setError('Не вдалося почати запис для перекладу.') }
    }

    start()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      stop()
    }
  }, [enabled, getStream, push, stop])

  const clear = useCallback(() => setLines([]), [])

  return { lines, error, busy, clear }
}
