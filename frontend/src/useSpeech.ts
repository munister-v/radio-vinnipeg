/**
 * Озвучення перекладу англійською.
 *
 * Синтез робить сам браузер (Web Speech API): голоси вже стоять в системі,
 * серверу нічого не коштує. Це важливо - машина одноядерна, і на ній вже
 * крутиться розпізнавання.
 *
 * Синтез працює локально в кожного слухача: людина сама вирішує, слухати
 * переклад голосом чи читати текстом.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

// Живий переклад цінний свіжістю. Якщо синтез не встигає за розмовою, чергу
// не нарощуємо, а викидаємо старе: краще почути останню фразу вчасно, ніж
// правильну послідовність із запізненням на півхвилини.
const MAX_QUEUE = 2

function supported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

export function englishVoices(): SpeechSynthesisVoice[] {
  if (!supported()) return []
  return window.speechSynthesis.getVoices().filter(v => /^en(-|_|$)/i.test(v.lang))
}

function pickVoice(preferURI: string): SpeechSynthesisVoice | null {
  const en = englishVoices()
  if (!en.length) return null
  // Явний вибір користувача важливіший за будь-який підбір, але голос міг
  // зникнути разом із мовним пакетом - тоді мовчки повертаємось до підбору.
  if (preferURI) {
    const exact = en.find(v => v.voiceURI === preferURI)
    if (exact) return exact
  }
  // Локальний голос звучить рівніше і не залежить від мережі.
  return en.find(v => v.localService && /en-US/i.test(v.lang))
    ?? en.find(v => v.localService)
    ?? en.find(v => /en-US/i.test(v.lang))
    ?? en[0]
}

type Opts = {
  /** Кличемо перед фразою і після неї - щоб приглушити кімнату на час озвучення. */
  onSpeakingChange?: (speaking: boolean) => void
  /** voiceURI обраного голосу; порожній рядок - підібрати самому. */
  voiceURI?: string
  /** Швидкість мовлення, 0.8-1.4. */
  rate?: number
}

export function useSpeech(enabled: boolean, opts?: Opts) {
  const [available, setAvailable] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const rateRef = useRef(opts?.rate ?? 1.05)
  rateRef.current = opts?.rate ?? 1.05
  const queueRef = useRef<string[]>([])
  const speakingRef = useRef(false)
  const onChangeRef = useRef(opts?.onSpeakingChange)
  onChangeRef.current = opts?.onSpeakingChange

  // Список голосів у більшості браузерів приходить асинхронно.
  useEffect(() => {
    if (!supported()) { setAvailable(false); return }
    const load = () => {
      setVoices(englishVoices())
      voiceRef.current = pickVoice(opts?.voiceURI ?? '')
      setAvailable(!!voiceRef.current)
    }
    load()
    window.speechSynthesis.addEventListener?.('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load)
  }, [opts?.voiceURI])

  const pump = useCallback(() => {
    if (!supported() || speakingRef.current) return
    const next = queueRef.current.shift()
    if (next === undefined) return
    const u = new SpeechSynthesisUtterance(next)
    if (voiceRef.current) { u.voice = voiceRef.current; u.lang = voiceRef.current.lang }
    else u.lang = 'en-US'
    u.rate = rateRef.current
    const done = () => {
      speakingRef.current = false
      onChangeRef.current?.(false)
      // Наступну фразу беремо тільки після завершення попередньої.
      if (queueRef.current.length) pump()
    }
    u.onend = done
    u.onerror = done
    speakingRef.current = true
    onChangeRef.current?.(true)
    try { window.speechSynthesis.speak(u) } catch { done() }
  }, [])

  const say = useCallback((text: string) => {
    if (!enabled || !supported()) return
    const clean = text.trim()
    if (!clean) return
    queueRef.current.push(clean)
    if (queueRef.current.length > MAX_QUEUE) {
      queueRef.current = queueRef.current.slice(-MAX_QUEUE)
    }
    pump()
  }, [enabled, pump])

  const stop = useCallback(() => {
    queueRef.current = []
    if (!supported()) return
    try { window.speechSynthesis.cancel() } catch { /* ignore */ }
    if (speakingRef.current) {
      speakingRef.current = false
      onChangeRef.current?.(false)
    }
  }, [])

  // Вимкнули озвучення або вийшли з кімнати - обриваємо на півслові.
  useEffect(() => { if (!enabled) stop() }, [enabled, stop])
  useEffect(() => stop, [stop])

  return { say, stop, available, voices }
}
