import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  getActiveCall,
  getCallConfig,
  getCallMembers,
  getToken,
  joinCall as apiJoinCall,
  leaveCall as apiLeaveCall,
  pollCallSignals,
  sendCallSignal,
  setCallMic,
  type CallMember,
} from './api'
import { setBackgroundInterval, type BgTimer } from './bgTimer'

const SIGNAL_POLL_MS = 1000
const QUALITY_POLL_MS = 3000

// Якість з'єднання за даними WebRTC getStats(): 'good' | 'ok' | 'weak'.
export type ConnectionQuality = 'good' | 'ok' | 'weak' | null

// Спроба отримати мікрофон з оптимальними constraints; fallback до simple audio
// якщо браузер (наприклад iOS Safari) відхиляє розширені параметри.
async function getMicStream(deviceId?: string): Promise<MediaStream> {
  const ideal: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: ideal })
  } catch (e) {
    if (e instanceof DOMException && (
      e.name === 'NotSupportedError' ||
      e.name === 'OverconstrainedError' ||
      e.name === 'ConstraintNotSatisfiedError'
    )) {
      // Fallback: мінімальні constraints — працює скрізь
      return await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId } : true })
    }
    throw e
  }
}
const MEMBERS_POLL_MS = 2500
const SPEAK_TICK_MS = 180
const SPEAK_THRESHOLD = 0.02 // RMS поріг «хтось говорить»

export type VoiceMember = CallMember & { speaking?: boolean }

type PeerEntry = {
  pc: RTCPeerConnection
  audio: HTMLAudioElement
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  restartTimer: number | null
  createdAt: number
  // Watchdog: відстеження «застряглого» з'єднання та зупиненого вхідного аудіо.
  lastBytes: number
  audioStallTicks: number
  notConnectedTicks: number
  recoverAttempts: number
}

type AnalyserEntry = {
  analyser: AnalyserNode
  source: MediaStreamAudioSourceNode
  data: Uint8Array<ArrayBuffer>
}

/**
 * Групова розмова (mesh WebRTC, perfect negotiation).
 *
 * Принципи (щоб дзвінок надійно з'єднувався):
 *  • На кожну пару — РІВНО один ініціатор: учасник із більшим id робить offer,
 *    із меншим — лише відповідає. Це усуває «glare» (зустрічні offer-и) і
 *    подвійні m-line, через які з'єднання раніше зривалось.
 *  • Канонічна perfect negotiation на setLocalDescription() без аргументів —
 *    браузер сам формує offer/answer і коректно робить rollback у ввічливого.
 *  • Приєднатися можна без мікрофона (лише слухати). Мікрофон вмикається будь-
 *    коли: ми змінюємо напрям транспондера → renegotiation, і нас починають чути.
 */
export function useVoice(myUserId: number | null, opts?: { volume?: number; micDeviceId?: string }) {
  const [members, setMembers] = useState<VoiceMember[]>([])
  const [joined, setJoined] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Реальна якість зв'язку (з RTCPeerConnection.getStats): RTT + втрати пакетів.
  const [quality, setQuality] = useState<ConnectionQuality>(null)
  const [connStats, setConnStats] = useState<{ rttMs: number; lossPercent: number }>({ rttMs: 0, lossPercent: 0 })

  const callIdRef = useRef<number | null>(null)
  const joinedRef = useRef(false)
  const micOnRef = useRef(false)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<number, PeerEntry>>(new Map())
  const pendingIceRef = useRef<Map<number, RTCIceCandidateInit[]>>(new Map())
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }])
  const afterIdRef = useRef(0)
  const serverMembersRef = useRef<CallMember[]>([])
  // Сигналінг та ростер опитуємо через Web Worker — виживає при блокуванні екрана.
  const signalTimerRef = useRef<BgTimer | null>(null)
  const membersTimerRef = useRef<BgTimer | null>(null)
  const volumeRef = useRef<number>(opts?.volume ?? 1)
  const micDeviceIdRef = useRef<string>(opts?.micDeviceId ?? '')
  // Аудіо-елементи, чий play() браузер заблокував (autoplay policy) — ретраїмо на жесті.
  const blockedAudiosRef = useRef<Set<HTMLAudioElement>>(new Set())
  const [audioBlocked, setAudioBlocked] = useState(false)

  // Визначення активності голосу (Web Audio).
  const audioCtxRef = useRef<AudioContext | null>(null)
  // Тихий зациклений вузол — тримає аудіо-сесію живою при блокуванні екрана.
  const keepAliveRef = useRef<AudioBufferSourceNode | null>(null)
  // Елемент <audio> з реальним WAV-блобом (NoSleep-трюк): iOS не вважає
  // AudioContext-тишу «активним медіа» і зупиняє аудіо-сесію на локскрині,
  // але розпізнає <audio>.play() як відтворення і тримає її живою.
  const noSleepElRef = useRef<HTMLAudioElement | null>(null)
  const analysersRef = useRef<Map<number, AnalyserEntry>>(new Map())
  const speakingRef = useRef<Map<number, boolean>>(new Map())
  const speakTimerRef = useRef<number | null>(null)
  // Моніторинг якості зв'язку.
  const qualityTimerRef = useRef<BgTimer | null>(null)
  const prevPacketsRef = useRef<Map<number, { lost: number; recv: number }>>(new Map())

  // ── Синхронізуємо volume/deviceId з opts без перестворення peers ────────────
  useEffect(() => {
    volumeRef.current = opts?.volume ?? 1
    for (const [, { audio }] of peersRef.current) {
      audio.volume = volumeRef.current
    }
  }, [opts?.volume])

  useEffect(() => {
    micDeviceIdRef.current = opts?.micDeviceId ?? ''
  }, [opts?.micDeviceId])

  // ── Список учасників: серверні дані + локальний прапорець «говорить» ──────
  const applyMembers = useCallback(() => {
    const list = serverMembersRef.current.map((m) => ({
      ...m,
      speaking: !!speakingRef.current.get(m.user_id),
    }))
    setMembers(list)
  }, [])

  // ── Аналіз гучності ──────────────────────────────────────────────────────
  const ensureAudioCtx = useCallback((): AudioContext | null => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctx) audioCtxRef.current = new Ctx()
    }
    audioCtxRef.current?.resume?.().catch(() => {})
    return audioCtxRef.current
  }, [])

  // Тихий зациклений source — не дає ОС приспати аудіо при блокуванні екрана.
  // Перезапускаємо, якщо AudioContext було призупинено (напр., екран вимкнено на iOS).
  const startKeepAlive = useCallback(() => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    // Якщо контекст не running (suspended після блокування екрана) — зупиняємо старий вузол.
    if (keepAliveRef.current && ctx.state !== 'running') {
      try { keepAliveRef.current.stop() } catch { /* ignore */ }
      keepAliveRef.current = null
    }
    if (keepAliveRef.current) return
    try {
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.loop = true
      const gain = ctx.createGain()
      gain.gain.value = 0.0001 // практично нечутно, але сесія лишається активною
      src.connect(gain).connect(ctx.destination)
      src.start()
      keepAliveRef.current = src
    } catch { /* непідтримувано — не критично */ }
  }, [])

  const stopKeepAlive = useCallback(() => {
    try { keepAliveRef.current?.stop() } catch { /* ignore */ }
    keepAliveRef.current = null
    if (noSleepElRef.current) {
      noSleepElRef.current.pause()
      noSleepElRef.current.src = ''
      noSleepElRef.current.remove()
      noSleepElRef.current = null
    }
  }, [])

  // Створюємо NoSleep <audio> — мінімальний зациклений WAV (44 bytes, 1 sample).
  // iOS Safari розпізнає <audio>.play() як активне відтворення і не вбиває
  // аудіо-сесію при блокуванні екрана, на відміну від AudioContext-тиші.
  const startNoSleep = useCallback(() => {
    if (noSleepElRef.current) return
    try {
      // PCM WAV: 8-bit, 8000 Hz, 1 channel, 1 sample (value 128 = silence)
      const wav = new Uint8Array([
        0x52,0x49,0x46,0x46,0x25,0x00,0x00,0x00,0x57,0x41,0x56,0x45,
        0x66,0x6d,0x74,0x20,0x10,0x00,0x00,0x00,0x01,0x00,0x01,0x00,
        0x40,0x1f,0x00,0x00,0x40,0x1f,0x00,0x00,0x01,0x00,0x08,0x00,
        0x64,0x61,0x74,0x61,0x01,0x00,0x00,0x00,0x80,
      ])
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
      const el = new Audio(url)
      el.loop = true
      el.volume = 0.001
      el.setAttribute('playsinline', '')
      ;(el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
      document.body.appendChild(el)
      noSleepElRef.current = el
      el.play().catch(() => {})
    } catch { /* непідтримувано */ }
  }, [])

  const detachAnalyser = useCallback((key: number) => {
    const a = analysersRef.current.get(key)
    if (!a) return
    try { a.source.disconnect() } catch { /* ignore */ }
    try { a.analyser.disconnect() } catch { /* ignore */ }
    analysersRef.current.delete(key)
    speakingRef.current.delete(key)
  }, [])

  const attachAnalyser = useCallback((key: number, stream: MediaStream) => {
    const ctx = ensureAudioCtx()
    if (!ctx || !stream.getAudioTracks().length) return
    detachAnalyser(key)
    try {
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      analysersRef.current.set(key, {
        analyser,
        source,
        data: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
      })
    } catch { /* ignore */ }
  }, [ensureAudioCtx, detachAnalyser])

  const speakTick = useCallback(() => {
    let changed = false
    for (const [key, a] of analysersRef.current) {
      a.analyser.getByteTimeDomainData(a.data)
      let sum = 0
      for (let i = 0; i < a.data.length; i++) {
        const v = (a.data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / a.data.length)
      const isSpeaking = rms > SPEAK_THRESHOLD
      if (speakingRef.current.get(key) !== isSpeaking) {
        speakingRef.current.set(key, isSpeaking)
        changed = true
      }
    }
    if (changed) {
      // Локальний стан «говорить» — окремо від аналізаторів (щоб не заважати AEC)
      setSpeaking(micOnRef.current)
      applyMembers()
    }
  }, [applyMembers])

  // ── Надійне відтворення аудіо співрозмовника ──────────────────────────────
  // Корінь бага «одного не чути»: коли учасник приєднується, поки ви не клікаєте,
  // браузер блокує audio.play() (autoplay policy) — і той співрозмовник назавжди
  // мовчить. Ловимо відмову, ставимо в чергу й повторюємо на першому ж жесті.
  const playAudioEl = useCallback((audio: HTMLAudioElement) => {
    const p = audio.play()
    if (p && typeof p.then === 'function') {
      p.then(() => {
        blockedAudiosRef.current.delete(audio)
        if (blockedAudiosRef.current.size === 0) setAudioBlocked(false)
      }).catch(() => {
        blockedAudiosRef.current.add(audio)
        setAudioBlocked(true)
      })
    }
  }, [])

  const unlockAudio = useCallback(() => {
    audioCtxRef.current?.resume?.().catch(() => {})
    // Повторюємо всі заблоковані + про всяк випадок усі активні елементи.
    for (const [, entry] of peersRef.current) {
      if (entry.audio.srcObject) playAudioEl(entry.audio)
    }
    for (const audio of [...blockedAudiosRef.current]) playAudioEl(audio)
  }, [playAudioEl])

  // Будь-яка взаємодія/повернення вкладки → намагаємось розблокувати звук.
  useEffect(() => {
    const onGesture = () => unlockAudio()
    const onVisible = () => { if (document.visibilityState === 'visible') unlockAudio() }
    window.addEventListener('pointerdown', onGesture)
    window.addEventListener('keydown', onGesture)
    window.addEventListener('touchend', onGesture)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
      window.removeEventListener('touchend', onGesture)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [unlockAudio])

  // ── Транспондер аудіо (їх завжди рівно один на з'єднання) ─────────────────
  const audioTransceiver = (pc: RTCPeerConnection): RTCRtpTransceiver | undefined =>
    pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio')

  // Голосу достатньо ~24 кбіт/с — обмежуємо, щоб не «з'їдати» мобільний інтернет
  // і знизити шанс заторів на слабкому зв'язку.
  const AUDIO_MAX_BITRATE = 24000

  const capSenderBitrate = useCallback((sender: RTCRtpSender) => {
    const params = sender.getParameters()
    if (!params.encodings?.length) params.encodings = [{}]
    if (params.encodings[0].maxBitrate === AUDIO_MAX_BITRATE) return
    params.encodings[0].maxBitrate = AUDIO_MAX_BITRATE
    sender.setParameters(params).catch(() => {})
  }, [])

  const applyMicToTransceiver = useCallback((tr: RTCRtpTransceiver) => {
    const track = localStreamRef.current?.getAudioTracks()[0] ?? null
    // Завжди sendrecv — обидва peer-и мають чути один одного незалежно від стану мікрофона.
    // Мовчання = null track, а не direction:'recvonly' (recvonly ламає двосторонній аудіо).
    tr.sender.replaceTrack(track).catch(() => {})
    if (tr.direction !== 'sendrecv' && tr.direction !== 'sendonly') {
      tr.direction = 'sendrecv'
    }
    capSenderBitrate(tr.sender)
  }, [capSenderBitrate])

  // ── Життєвий цикл peer-з'єднань ───────────────────────────────────────────
  const cleanupPeer = useCallback((userId: number) => {
    const entry = peersRef.current.get(userId)
    if (!entry) return
    if (entry.restartTimer) {
      window.clearTimeout(entry.restartTimer)
      entry.restartTimer = null
    }
    try { entry.pc.close() } catch { /* ignore */ }
    entry.audio.srcObject = null
    entry.audio.remove()
    blockedAudiosRef.current.delete(entry.audio)
    peersRef.current.delete(userId)
    pendingIceRef.current.delete(userId)
    detachAnalyser(userId)
  }, [detachAnalyser])

  const cleanupAll = useCallback(() => {
    for (const [userId] of peersRef.current) cleanupPeer(userId)
    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop()
      localStreamRef.current = null
    }
  }, [cleanupPeer])

  const flushPendingIce = useCallback(async (userId: number, pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(userId)
    if (!queued?.length) return
    pendingIceRef.current.delete(userId)
    for (const cand of queued) {
      try { await pc.addIceCandidate(cand) } catch { /* ignore */ }
    }
  }, [])

  const reconnectViaRelayRef = useRef<(peerId: number) => void>(() => {})
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  // Зберігаємо посилання на функцію, щоб sentinel.onrelease міг перезапитати без циклічних залежностей.
  const acquireWakeLockRef = useRef<() => Promise<void>>(async () => {})

  // Не даємо екрану/CPU засинати під час дзвінка (Android Chrome/PWA).
  const acquireWakeLock = useCallback(async () => {
    try {
      if (!navigator.wakeLock) return
      const sentinel = await navigator.wakeLock.request('screen')
      wakeLockRef.current = sentinel
      // ОС автоматично знімає wake lock при блокуванні — перезапитуємо при поверненні.
      sentinel.addEventListener('release', () => {
        wakeLockRef.current = null
        if (document.visibilityState === 'visible' && joinedRef.current) {
          acquireWakeLockRef.current()
        }
      }, { once: true })
    } catch { /* непідтримується або відмовлено — не критично */ }
  }, [])
  acquireWakeLockRef.current = acquireWakeLock

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
  }, [])

  // Позначаємо дзвінок як активне медіа — браузер не призупиняє аудіо при згортанні.
  const setupMediaSession = useCallback(() => {
    if (!('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Радіорозмова наживо',
        artist: 'Winnipeg Nights',
      })
      navigator.mediaSession.playbackState = 'playing'
      const resist = () => { navigator.mediaSession.playbackState = 'playing' }
      navigator.mediaSession.setActionHandler('play', resist)
      navigator.mediaSession.setActionHandler('pause', resist)
      // 'stop' — iOS натискає цю кнопку на локскрині і вбиває аудіо-сесію.
      // Резистуємо: ігноруємо зупинку, повертаємо 'playing'.
      try { navigator.mediaSession.setActionHandler('stop', resist) } catch { /* older Safari */ }
    } catch { /* ignore */ }
  }, [])

  const teardownMediaSession = useCallback(() => {
    if (!('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      try { navigator.mediaSession.setActionHandler('stop', null) } catch { /* ignore */ }
    } catch { /* ignore */ }
  }, [])

  const createPeer = useCallback(
    (peerId: number, opts: { initiator: boolean; forceRelay?: boolean }): PeerEntry | undefined => {
      const existing = peersRef.current.get(peerId)
      if (existing) return existing
      if (!myUserId || !callIdRef.current) return undefined

      const polite = myUserId < peerId // менший id — ввічливий, лише відповідає
      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current,
        // Якщо звичайне з'єднання (з ICE-restart) не вдалося — примусово
        // йдемо лише через TURN-relay. Часто рятує симетричний NAT/мобільний інтернет.
        iceTransportPolicy: opts.forceRelay ? 'relay' : 'all',
        // Заздалегідь готує ICE-кандидати (в т.ч. TURN-allocation) — швидше з'єднання.
        iceCandidatePoolSize: 4,
      })
      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.volume = volumeRef.current
      ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
      audio.setAttribute('playsinline', '')
      audio.style.display = 'none'
      // iOS може заглушити елемент при блокуванні екрана — відновлюємо одразу.
      audio.addEventListener('pause', () => {
        if (joinedRef.current && audio.srcObject) audio.play().catch(() => {})
      })
      document.body.appendChild(audio)

      const entry: PeerEntry = {
        pc,
        audio,
        polite,
        makingOffer: false,
        ignoreOffer: false,
        restartTimer: null,
        createdAt: Date.now(),
        lastBytes: 0,
        audioStallTicks: 0,
        notConnectedTicks: 0,
        recoverAttempts: 0,
      }
      peersRef.current.set(peerId, entry)

      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track])
        audio.srcObject = stream
        audio.muted = false
        playAudioEl(audio) // надійне відтворення з ретраєм через жест користувача
        attachAnalyser(peerId, stream)
      }
      pc.onicecandidate = (e) => {
        if (e.candidate && callIdRef.current) {
          sendCallSignal(callIdRef.current, peerId, 'ice', e.candidate.toJSON()).catch(() => {})
        }
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected' && entry.restartTimer) {
          window.clearTimeout(entry.restartTimer)
          entry.restartTimer = null
        }
        if (pc.connectionState === 'failed') {
          if (entry.restartTimer) window.clearTimeout(entry.restartTimer)
          if (opts.forceRelay) {
            // Уже пробували relay-only — далі лишається тільки прибрати peer-а.
            cleanupPeer(peerId)
            return
          }
          try { pc.restartIce() } catch { cleanupPeer(peerId); return }
          entry.restartTimer = window.setTimeout(() => {
            entry.restartTimer = null
            if (pc.connectionState === 'failed') reconnectViaRelayRef.current(peerId)
          }, 8000)
        } else if (pc.connectionState === 'closed') {
          cleanupPeer(peerId)
        }
      }
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' && !entry.restartTimer) {
          entry.restartTimer = window.setTimeout(() => {
            entry.restartTimer = null
            if (pc.iceConnectionState === 'disconnected') {
              try { pc.restartIce() } catch { cleanupPeer(peerId) }
            }
          }, 2500)
        }
      }
      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true
          await pc.setLocalDescription()
          if (callIdRef.current && pc.localDescription) {
            await sendCallSignal(
              callIdRef.current,
              peerId,
              pc.localDescription.type as 'offer' | 'answer',
              pc.localDescription,
            )
          }
        } catch { /* ignore */ } finally {
          entry.makingOffer = false
        }
      }

      // Ініціатор одразу створює транспондер → onnegotiationneeded → offer.
      // ЗАВЖДИ sendrecv: лише так обидві сторони можуть отримати аудіо одна від одної.
      // Якщо мікрофон вимкнено, трек = null (тиша), але напрям залишається sendrecv.
      if (opts.initiator) {
        const track = localStreamRef.current?.getAudioTracks()[0] ?? null
        if (track) pc.addTransceiver(track, { direction: 'sendrecv' })
        else pc.addTransceiver('audio', { direction: 'sendrecv' })
      }
      return entry
    },
    [myUserId, attachAnalyser, cleanupPeer],
  )

  // Хто кого ініціює: більший id → ініціатор.
  const ensurePeer = useCallback(
    (peerId: number) => {
      if (!myUserId || peersRef.current.has(peerId)) return
      createPeer(peerId, { initiator: myUserId > peerId })
    },
    [myUserId, createPeer],
  )

  // ICE-restart не допоміг → пересоздаём з'єднання, форсуючи TURN-relay.
  const reconnectViaRelay = useCallback(
    (peerId: number) => {
      if (!myUserId) return
      cleanupPeer(peerId)
      createPeer(peerId, { initiator: myUserId > peerId, forceRelay: true })
    },
    [myUserId, cleanupPeer, createPeer],
  )
  reconnectViaRelayRef.current = reconnectViaRelay

  const handleDescription = useCallback(
    async (fromId: number, description: RTCSessionDescriptionInit) => {
      let entry = peersRef.current.get(fromId)
      if (!entry) entry = createPeer(fromId, { initiator: false })
      if (!entry) return
      const { pc } = entry

      const isOffer = description.type === 'offer'
      const offerCollision = isOffer && (entry.makingOffer || pc.signalingState !== 'stable')
      entry.ignoreOffer = !entry.polite && offerCollision
      if (entry.ignoreOffer) return

      try {
        await pc.setRemoteDescription(description)
      } catch { return }
      await flushPendingIce(fromId, pc)

      if (isOffer) {
        const tr = audioTransceiver(pc)
        if (tr) applyMicToTransceiver(tr)
        await pc.setLocalDescription()
        if (callIdRef.current && pc.localDescription) {
          await sendCallSignal(
            callIdRef.current,
            fromId,
            pc.localDescription.type as 'offer' | 'answer',
            pc.localDescription,
          ).catch(() => {})
        }
      }
    },
    [createPeer, flushPendingIce, applyMicToTransceiver],
  )

  const handleIce = useCallback(async (fromId: number, cand: RTCIceCandidateInit) => {
    const entry = peersRef.current.get(fromId)
    if (!entry || !entry.pc.remoteDescription) {
      const q = pendingIceRef.current.get(fromId) ?? []
      q.push(cand)
      pendingIceRef.current.set(fromId, q)
      return
    }
    try {
      await entry.pc.addIceCandidate(cand)
    } catch {
      // Кандидати, що приходять під час ігнорованого offer-у, можна відкинути.
    }
  }, [])

  const pollSignals = useCallback(async () => {
    const cid = callIdRef.current
    if (!cid) return
    try {
      const signals = await pollCallSignals(cid, afterIdRef.current)
      for (const sig of signals) {
        afterIdRef.current = sig.id
        const from = sig.from_user_id
        let payload: unknown = null
        try { payload = JSON.parse(sig.payload) } catch { payload = sig.payload }
        try {
          if (sig.signal_type === 'offer' || sig.signal_type === 'answer') {
            await handleDescription(from, payload as RTCSessionDescriptionInit)
          } else if (sig.signal_type === 'ice') {
            await handleIce(from, payload as RTCIceCandidateInit)
          } else if (sig.signal_type === 'bye') {
            cleanupPeer(from)
          }
        } catch { /* ignore single-signal failures */ }
      }
    } catch { /* ignore transient poll errors */ }
  }, [handleDescription, handleIce, cleanupPeer])

  const pollMembers = useCallback(async () => {
    const cid = callIdRef.current
    if (!cid || !joinedRef.current) return
    try {
      const list = await getCallMembers(cid)
      serverMembersRef.current = list
      applyMembers()
      const ids = new Set(list.map((m) => m.user_id))
      for (const m of list) {
        // If this peer exists but its connection is dead (failed/closed),
        // drop it so ensurePeer recreates a fresh one. This handles the
        // case where a user briefly disconnects and rejoins with the same
        // userId without us receiving a 'bye' signal.
        const existing = peersRef.current.get(m.user_id)
        if (existing) {
          const state = existing.pc.connectionState
          if (state === 'failed' || state === 'closed') cleanupPeer(m.user_id)
        }
        ensurePeer(m.user_id)
      }
      for (const peerId of [...peersRef.current.keys()]) {
        if (!ids.has(peerId)) cleanupPeer(peerId)
      }
      // Тримаємо вхідне аудіо живим у фоні / після блокування екрана.
      // Цей таймер крутиться на Web Worker, тож виконується навіть при
      // згорнутій/заблокованій вкладці, коли visibilitychange не спрацьовує.
      audioCtxRef.current?.resume?.().catch(() => {})
      for (const [, entry] of peersRef.current) {
        if (entry.audio.srcObject && entry.audio.paused) entry.audio.play().catch(() => {})
      }
    } catch { /* ignore */ }
  }, [applyMembers, ensurePeer, cleanupPeer])

  const loadIceServers = useCallback(async () => {
    try {
      const cfg = await getCallConfig()
      if (cfg.ice_servers?.length) iceServersRef.current = cfg.ice_servers
    } catch { /* keep default STUN */ }
  }, [])

  // Якість зв'язку + watchdog: ловить пари, де «одного не чути» (з'єднання є,
  // але вхідне аудіо не тече) чи переговорка застрягла, і відновлює їх.
  const pollQuality = useCallback(async () => {
    const peers = peersRef.current
    if (!joinedRef.current || peers.size === 0) { setQuality(null); return }
    const micOnByUser = new Map<number, boolean>()
    for (const m of serverMembersRef.current) micOnByUser.set(m.user_id, !!m.mic_on)

    let worstRtt = 0
    let worstLoss = 0
    let sawConnected = false
    const recover: number[] = []

    for (const [peerId, entry] of peers) {
      const state = entry.pc.connectionState
      // 1) Застрягла переговорка: не доходить до 'connected' за розумний час.
      if (state !== 'connected') {
        const age = Date.now() - entry.createdAt
        if (state === 'failed' || state === 'closed') continue // обробляється onconnectionstatechange
        if (age > 8000) {
          entry.notConnectedTicks++
          if (entry.notConnectedTicks >= 3) recover.push(peerId)
        }
        continue
      }
      entry.notConnectedTicks = 0
      sawConnected = true

      let stats: RTCStatsReport
      try { stats = await entry.pc.getStats() } catch { continue }
      let bytes = 0
      stats.forEach((r) => {
        if (r.type === 'candidate-pair' && (r.nominated || r.selected) && typeof r.currentRoundTripTime === 'number') {
          worstRtt = Math.max(worstRtt, r.currentRoundTripTime)
        }
        if (r.type === 'inbound-rtp' && (r.kind ?? r.mediaType) === 'audio') {
          bytes = Math.max(bytes, r.bytesReceived ?? 0)
          const lost = r.packetsLost ?? 0
          const recv = r.packetsReceived ?? 0
          const prev = prevPacketsRef.current.get(peerId) ?? { lost: 0, recv: 0 }
          const dLost = lost - prev.lost
          const dRecv = recv - prev.recv
          prevPacketsRef.current.set(peerId, { lost, recv })
          if (dLost + dRecv > 0) worstLoss = Math.max(worstLoss, dLost / (dLost + dRecv))
        }
      })

      // 2) «Одного не чути»: peer каже, що мікрофон увімкнено, з'єднання є,
      //    але вхідні байти не ростуть кілька тіків поспіль.
      const remoteMicOn = micOnByUser.get(peerId) ?? false
      if (remoteMicOn && bytes <= entry.lastBytes) {
        entry.audioStallTicks++
        if (entry.audioStallTicks >= 3) recover.push(peerId)
      } else {
        entry.audioStallTicks = 0
        if (bytes > entry.lastBytes) entry.recoverAttempts = 0 // аудіо тече — скидаємо ескалацію
      }
      entry.lastBytes = bytes
    }

    // Відновлення: спершу ICE-restart, далі — повне перестворення через relay.
    for (const peerId of recover) {
      const entry = peers.get(peerId)
      if (!entry) continue
      entry.notConnectedTicks = 0
      entry.audioStallTicks = 0
      if (entry.recoverAttempts === 0) {
        entry.recoverAttempts = 1
        try { entry.pc.restartIce() } catch { reconnectViaRelay(peerId) }
      } else {
        reconnectViaRelay(peerId)
      }
    }

    if (!sawConnected) { setQuality(null); return }
    setConnStats({ rttMs: Math.round(worstRtt * 1000), lossPercent: parseFloat((worstLoss * 100).toFixed(1)) })
    if (worstRtt < 0.2 && worstLoss < 0.02) setQuality('good')
    else if (worstRtt < 0.45 && worstLoss < 0.07) setQuality('ok')
    else setQuality('weak')
  }, [reconnectViaRelay])

  const startTimers = useCallback(() => {
    signalTimerRef.current?.stop()
    membersTimerRef.current?.stop()
    if (speakTimerRef.current) window.clearInterval(speakTimerRef.current)
    // Сигналінг + ростер — на воркер-таймері (живе у фоні/при блокуванні).
    signalTimerRef.current = setBackgroundInterval(pollSignals, SIGNAL_POLL_MS)
    membersTimerRef.current = setBackgroundInterval(pollMembers, MEMBERS_POLL_MS)
    // Детектор гучності потрібен лише для видимого UI — звичайний таймер.
    speakTimerRef.current = window.setInterval(speakTick, SPEAK_TICK_MS)
    // Watchdog якості (getStats + reconnect) — на воркер-таймері, живе при блокуванні.
    qualityTimerRef.current?.stop()
    qualityTimerRef.current = setBackgroundInterval(pollQuality, QUALITY_POLL_MS)
  }, [pollSignals, pollMembers, speakTick, pollQuality])

  const stopTimers = useCallback(() => {
    signalTimerRef.current?.stop(); signalTimerRef.current = null
    membersTimerRef.current?.stop(); membersTimerRef.current = null
    if (speakTimerRef.current) { window.clearInterval(speakTimerRef.current); speakTimerRef.current = null }
    qualityTimerRef.current?.stop(); qualityTimerRef.current = null
    prevPacketsRef.current.clear()
    setQuality(null)
  }, [])

  // Стан розмови до приєднання (скільки людей уже всередині).
  const refreshActive = useCallback(async () => {
    try {
      const data = await getActiveCall()
      if (data) {
        callIdRef.current = data.call_id
        if (!joinedRef.current) {
          serverMembersRef.current = data.members
          applyMembers()
        }
      } else if (!joinedRef.current) {
        callIdRef.current = null
        serverMembersRef.current = []
        applyMembers()
      }
    } catch { /* ignore */ }
  }, [applyMembers])

  useEffect(() => {
    refreshActive()
    const t = window.setInterval(() => {
      if (!joinedRef.current) refreshActive()
    }, MEMBERS_POLL_MS)
    return () => window.clearInterval(t)
  }, [refreshActive])

  const join = useCallback(async () => {
    setError(null)
    setConnecting(true)
    try {
      ensureAudioCtx()
      startKeepAlive()
      startNoSleep()
      await loadIceServers()
      const res = await apiJoinCall()
      callIdRef.current = res.call_id
      // Start from the latest existing signal so we don't replay stale
      // offers/answers from previous sessions in this call (join-bug fix).
      afterIdRef.current = res.latest_signal_id ?? 0
      joinedRef.current = true
      setJoined(true)
      serverMembersRef.current = res.members
      applyMembers()
      for (const m of res.members) ensurePeer(m.user_id)
      startTimers()
      // Не чекаємо на інтервали — одразу підхоплюємо сигнали/учасників.
      pollMembers()
      pollSignals()
      acquireWakeLock()
      setupMediaSession()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося приєднатись до розмови.')
    } finally {
      setConnecting(false)
    }
  }, [ensureAudioCtx, startKeepAlive, startNoSleep, loadIceServers, applyMembers, ensurePeer, startTimers, pollMembers, pollSignals, acquireWakeLock, setupMediaSession])

  const leave = useCallback(async () => {
    const cid = callIdRef.current
    stopTimers()
    stopKeepAlive()
    releaseWakeLock()
    teardownMediaSession()
    for (const [peerId] of peersRef.current) {
      if (cid) sendCallSignal(cid, peerId, 'bye', { bye: true }).catch(() => {})
    }
    cleanupAll()
    joinedRef.current = false
    micOnRef.current = false
    setJoined(false)
    setMicOn(false)
    setSpeaking(false)
    setError(null)
    speakingRef.current.clear()
    serverMembersRef.current = []
    setMembers([])
    if (cid) {
      try { await apiLeaveCall(cid) } catch { /* ignore */ }
    }
    await refreshActive()
  }, [stopTimers, stopKeepAlive, releaseWakeLock, teardownMediaSession, cleanupAll, refreshActive])

  // Постійний мікрофон-стрім: отримуємо ОДИН раз і тримаємо, поки в розмові.
  // PTT/мьют перемикають лише track.enabled — миттєво, без повторного
  // getUserMedia і без renegotiation. Саме повторний захват пристрою на кожне
  // натискання спричиняв «звук пропадає/з'являється» на телефоні (переініціалізація
  // мікрофона + AEC/AGC). Пристрій звільняємо лише при виході з розмови.
  const ensureMicStream = useCallback(async (): Promise<MediaStreamTrack | null> => {
    const live = localStreamRef.current?.getAudioTracks().find((t) => t.readyState === 'live')
    if (live) return live
    const stream = await getMicStream(micDeviceIdRef.current)
    localStreamRef.current = stream
    const track = stream.getAudioTracks()[0] ?? null
    if (track) {
      track.enabled = false // вмикаємо за потребою (PTT/мьют)
      track.onended = () => {
        if (localStreamRef.current !== stream) return
        localStreamRef.current = null
        micOnRef.current = false
        setMicOn(false)
        setSpeaking(false)
        if (callIdRef.current) setCallMic(callIdRef.current, false).catch(() => {})
      }
      // Привʼязуємо трек до всіх зʼєднань (replaceTrack без renegotiation).
      for (const [, entry] of peersRef.current) {
        const tr = audioTransceiver(entry.pc)
        if (tr) applyMicToTransceiver(tr)
      }
    }
    return track
  }, [applyMicToTransceiver])

  const setTransmitting = useCallback(async (on: boolean) => {
    const cid = callIdRef.current
    if (!cid) return

    if (on) {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Цей браузер не підтримує мікрофон.')
        return
      }
      let track: MediaStreamTrack | null
      try {
        track = await ensureMicStream()
      } catch (err) {
        micOnRef.current = false
        if (err instanceof DOMException) {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setError('Доступ до мікрофона заблоковано. Дозвольте мікрофон у налаштуваннях браузера.')
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            setError('Мікрофон не знайдено на цьому пристрої.')
          } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            setError('Мікрофон зайнятий іншою програмою.')
          } else {
            setError('Не вдалося увімкнути мікрофон.')
          }
        } else {
          setError('Не вдалося увімкнути мікрофон.')
        }
        return
      }
      if (!track) { setError('Не вдалося увімкнути мікрофон.'); return }
      // Web Audio міг бути призупинений у фоні — без resume трек «німий».
      audioCtxRef.current?.resume?.().catch(() => {})
      track.enabled = true
      micOnRef.current = true
      setMicOn(true)
      setSpeaking(true)
      setError(null)
    } else {
      const track = localStreamRef.current?.getAudioTracks()[0]
      if (track) track.enabled = false // тиша миттєво, пристрій НЕ звільняємо
      micOnRef.current = false
      setMicOn(false)
      setSpeaking(false)
    }
    setCallMic(cid, on).catch(() => {})
  }, [ensureMicStream])

  const toggleMic = useCallback(async () => {
    await setTransmitting(!micOnRef.current)
  }, [setTransmitting])

  // Користувач закрив вкладку — повідомляємо сервер, щоб його прибрали зі списку.
  useEffect(() => {
    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return
      const cid = callIdRef.current
      if (!joinedRef.current || !cid) return
      const token = getToken()
      fetch(`/api/calls/${cid}/leave`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        keepalive: true,
      }).catch(() => {})
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [])

  // Mobile Safari/Chrome можуть приспати Web Audio і мережу при згортанні.
  // Після повернення відновлюємо звук, polling та ICE без повторного входу.
  useEffect(() => {
    const recoverMobileSession = () => {
      if (document.visibilityState === 'hidden' || !joinedRef.current) return
      ensureAudioCtx()
      startKeepAlive()
      startNoSleep()   // iOS: тримаємо аудіо-сесію через реальний <audio>
      acquireWakeLock()
      setupMediaSession()
      for (const [, entry] of peersRef.current) {
        entry.audio.play().catch(() => {})
        if (
          entry.pc.connectionState === 'failed' ||
          entry.pc.iceConnectionState === 'disconnected'
        ) {
          try { entry.pc.restartIce() } catch { /* next member poll recreates it */ }
        }
      }
      // Якщо мікрофон був увімкнений, а iOS завершила трек під час локскрину —
      // перезахоплюємо пристрій щоб голос знову пішов до peers.
      if (micOnRef.current) {
        const track = localStreamRef.current?.getAudioTracks()[0]
        if (!track || track.readyState === 'ended') {
          ensureMicStream().then((t) => { if (t) t.enabled = true }).catch(() => {})
        } else {
          track.enabled = true
          audioCtxRef.current?.resume?.().catch(() => {})
        }
      }
      startTimers()
      pollMembers()
      pollSignals()
    }

    document.addEventListener('visibilitychange', recoverMobileSession)
    window.addEventListener('online', recoverMobileSession)
    window.addEventListener('pageshow', recoverMobileSession)
    return () => {
      document.removeEventListener('visibilitychange', recoverMobileSession)
      window.removeEventListener('online', recoverMobileSession)
      window.removeEventListener('pageshow', recoverMobileSession)
    }
  }, [ensureAudioCtx, startKeepAlive, startNoSleep, startTimers, pollMembers, pollSignals, acquireWakeLock, setupMediaSession, ensureMicStream])

  useEffect(() => {
    return () => {
      stopTimers()
      stopKeepAlive()
      cleanupAll()
      releaseWakeLock()
      teardownMediaSession()
      audioCtxRef.current?.close?.().catch(() => {})
      audioCtxRef.current = null
    }
  }, [stopTimers, stopKeepAlive, cleanupAll, releaseWakeLock, teardownMediaSession])

  return { members, joined, micOn, connecting, error, speaking, quality, connStats, audioBlocked, unlockAudio, join, leave, toggleMic }
}
