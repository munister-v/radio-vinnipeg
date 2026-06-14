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

const SIGNAL_POLL_MS = 1000

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

  const callIdRef = useRef<number | null>(null)
  const joinedRef = useRef(false)
  const micOnRef = useRef(false)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<number, PeerEntry>>(new Map())
  const pendingIceRef = useRef<Map<number, RTCIceCandidateInit[]>>(new Map())
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }])
  const afterIdRef = useRef(0)
  const serverMembersRef = useRef<CallMember[]>([])
  const signalTimerRef = useRef<number | null>(null)
  const membersTimerRef = useRef<number | null>(null)
  const volumeRef = useRef<number>(opts?.volume ?? 1)
  const micDeviceIdRef = useRef<string>(opts?.micDeviceId ?? '')

  // Визначення активності голосу (Web Audio).
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analysersRef = useRef<Map<number, AnalyserEntry>>(new Map())
  const speakingRef = useRef<Map<number, boolean>>(new Map())
  const speakTimerRef = useRef<number | null>(null)

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

  // ── Транспондер аудіо (їх завжди рівно один на з'єднання) ─────────────────
  const audioTransceiver = (pc: RTCPeerConnection): RTCRtpTransceiver | undefined =>
    pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio')

  const applyMicToTransceiver = useCallback((tr: RTCRtpTransceiver) => {
    const track = localStreamRef.current?.getAudioTracks()[0] ?? null
    // Завжди sendrecv — обидва peer-и мають чути один одного незалежно від стану мікрофона.
    // Мовчання = null track, а не direction:'recvonly' (recvonly ламає двосторонній аудіо).
    tr.sender.replaceTrack(track).catch(() => {})
    if (tr.direction !== 'sendrecv' && tr.direction !== 'sendonly') {
      tr.direction = 'sendrecv'
    }
  }, [])

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

  // Не даємо екрану/CPU засинати під час дзвінка (Android Chrome/PWA).
  const acquireWakeLock = useCallback(async () => {
    try {
      wakeLockRef.current = await navigator.wakeLock?.request('screen')
    } catch { /* непідтримується або відмовлено — не критично */ }
  }, [])

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
        artist: 'Radio Vinnipeg',
      })
      navigator.mediaSession.playbackState = 'playing'
      navigator.mediaSession.setActionHandler('play', () => { navigator.mediaSession.playbackState = 'playing' })
      navigator.mediaSession.setActionHandler('pause', () => { navigator.mediaSession.playbackState = 'playing' })
    } catch { /* ignore */ }
  }, [])

  const teardownMediaSession = useCallback(() => {
    if (!('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
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
      })
      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.volume = volumeRef.current
      ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
      audio.setAttribute('playsinline', '')
      audio.style.display = 'none'
      document.body.appendChild(audio)

      const entry: PeerEntry = {
        pc,
        audio,
        polite,
        makingOffer: false,
        ignoreOffer: false,
        restartTimer: null,
      }
      peersRef.current.set(peerId, entry)

      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track])
        audio.srcObject = stream
        audio.play().catch(() => {})
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
      for (const m of list) ensurePeer(m.user_id)
      for (const peerId of [...peersRef.current.keys()]) {
        if (!ids.has(peerId)) cleanupPeer(peerId)
      }
    } catch { /* ignore */ }
  }, [applyMembers, ensurePeer, cleanupPeer])

  const loadIceServers = useCallback(async () => {
    try {
      const cfg = await getCallConfig()
      if (cfg.ice_servers?.length) iceServersRef.current = cfg.ice_servers
    } catch { /* keep default STUN */ }
  }, [])

  const startTimers = useCallback(() => {
    if (signalTimerRef.current) window.clearInterval(signalTimerRef.current)
    if (membersTimerRef.current) window.clearInterval(membersTimerRef.current)
    if (speakTimerRef.current) window.clearInterval(speakTimerRef.current)
    signalTimerRef.current = window.setInterval(pollSignals, SIGNAL_POLL_MS)
    membersTimerRef.current = window.setInterval(pollMembers, MEMBERS_POLL_MS)
    speakTimerRef.current = window.setInterval(speakTick, SPEAK_TICK_MS)
  }, [pollSignals, pollMembers, speakTick])

  const stopTimers = useCallback(() => {
    for (const ref of [signalTimerRef, membersTimerRef, speakTimerRef]) {
      if (ref.current) { window.clearInterval(ref.current); ref.current = null }
    }
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
      ensureAudioCtx() // розблокувати аудіо в межах кліку користувача
      await loadIceServers()
      const res = await apiJoinCall()
      callIdRef.current = res.call_id
      afterIdRef.current = 0
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
  }, [ensureAudioCtx, loadIceServers, applyMembers, ensurePeer, startTimers, pollMembers, pollSignals, acquireWakeLock, setupMediaSession])

  const leave = useCallback(async () => {
    const cid = callIdRef.current
    stopTimers()
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
  }, [stopTimers, cleanupAll, refreshActive])

  const toggleMic = useCallback(async () => {
    const cid = callIdRef.current
    if (!cid) return
    const next = !micOnRef.current

    if (next) {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError('Цей браузер не підтримує мікрофон.')
          return
        }
        const stream = await getMicStream(micDeviceIdRef.current)
        localStreamRef.current = stream
        micOnRef.current = true
        const track = stream.getAudioTracks()[0]
        if (track) {
          track.onended = () => {
            if (localStreamRef.current !== stream) return
            localStreamRef.current = null
            micOnRef.current = false
            setMicOn(false)
            setSpeaking(false)
            for (const [, entry] of peersRef.current) {
              const tr = audioTransceiver(entry.pc)
              if (tr) applyMicToTransceiver(tr)
            }
            if (callIdRef.current) setCallMic(callIdRef.current, false).catch(() => {})
          }
        }
        setSpeaking(true)
        for (const [, entry] of peersRef.current) {
          const tr = audioTransceiver(entry.pc)
          if (tr) applyMicToTransceiver(tr)
        }
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
    } else {
      micOnRef.current = false
      for (const [, entry] of peersRef.current) {
        const tr = audioTransceiver(entry.pc)
        if (tr) applyMicToTransceiver(tr)
      }
      const stream = localStreamRef.current
      if (stream) {
        for (const t of stream.getTracks()) t.stop()
        localStreamRef.current = null
      }
      setSpeaking(false)
    }

    setMicOn(next)
    setError(null)
    setCallMic(cid, next).catch(() => {})
  }, [applyMicToTransceiver])

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
      acquireWakeLock() // wake lock автоматично знімається браузером при згортанні
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
  }, [ensureAudioCtx, startTimers, pollMembers, pollSignals, acquireWakeLock, setupMediaSession])

  useEffect(() => {
    return () => {
      stopTimers()
      cleanupAll()
      releaseWakeLock()
      teardownMediaSession()
      audioCtxRef.current?.close?.().catch(() => {})
      audioCtxRef.current = null
    }
  }, [stopTimers, cleanupAll, releaseWakeLock, teardownMediaSession])

  return { members, joined, micOn, connecting, error, speaking, join, leave, toggleMic }
}
