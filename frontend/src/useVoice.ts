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

const SIGNAL_POLL_MS = 1500
const MEMBERS_POLL_MS = 2500

export type VoiceMember = CallMember & { speaking?: boolean }

type PeerEntry = {
  pc: RTCPeerConnection
  audio: HTMLAudioElement
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
}

/**
 * Групова розмова (mesh, perfect negotiation). Приєднатися можна без
 * мікрофона — лише слухати; мікрофон увімкнути може будь-хто за бажанням.
 */
export function useVoice(myUserId: number | null) {
  const [members, setMembers] = useState<VoiceMember[]>([])
  const [joined, setJoined] = useState(false)
  const [micOn, setMicOn] = useState(false)
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
  const signalTimerRef = useRef<number | null>(null)
  const membersTimerRef = useRef<number | null>(null)

  const cleanupPeer = useCallback((userId: number) => {
    const entry = peersRef.current.get(userId)
    if (!entry) return
    entry.pc.close()
    entry.audio.srcObject = null
    entry.audio.remove()
    peersRef.current.delete(userId)
    pendingIceRef.current.delete(userId)
  }, [])

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
      try {
        await pc.addIceCandidate(cand)
      } catch {
        // ignore
      }
    }
  }, [])

  // Один аудіо-transceiver на з'єднання: sendrecv (з треком, якщо мікрофон
  // увімкнено) або recvonly (лише слухати). Перемикання мікрофона змінює
  // direction/трек цього ж transceiver-а — це викликає renegotiation.
  const createPeer = useCallback((peerId: number) => {
    if (peersRef.current.has(peerId) || !myUserId) return
    const cid = callIdRef.current
    if (!cid) return

    const polite = myUserId < peerId
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })
    const audio = document.createElement('audio')
    audio.autoplay = true
    ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
    audio.setAttribute('playsinline', '')
    audio.style.display = 'none'
    document.body.appendChild(audio)

    const entry: PeerEntry = { pc, audio, polite, makingOffer: false, ignoreOffer: false }
    peersRef.current.set(peerId, entry)

    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0]
      audio.play().catch(() => {})
    }
    pc.onicecandidate = (e) => {
      if (e.candidate && callIdRef.current) {
        sendCallSignal(callIdRef.current, peerId, 'ice', e.candidate.toJSON()).catch(() => {})
      }
    }
    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true
        const offer = await pc.createOffer()
        if (pc.signalingState !== 'stable') return
        await pc.setLocalDescription(offer)
        if (callIdRef.current) {
          await sendCallSignal(callIdRef.current, peerId, 'offer', pc.localDescription)
        }
      } catch {
        // ignore
      } finally {
        entry.makingOffer = false
      }
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        cleanupPeer(peerId)
      }
    }

    if (localStreamRef.current) {
      pc.addTrack(localStreamRef.current.getAudioTracks()[0], localStreamRef.current)
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' })
    }
  }, [myUserId, cleanupPeer])

  const handleOffer = useCallback(async (fromId: number, offer: RTCSessionDescriptionInit) => {
    if (!peersRef.current.has(fromId)) createPeer(fromId)
    const entry = peersRef.current.get(fromId)
    if (!entry) return
    const { pc } = entry

    const offerCollision = entry.makingOffer || pc.signalingState !== 'stable'
    entry.ignoreOffer = !entry.polite && offerCollision
    if (entry.ignoreOffer) return

    if (offerCollision) {
      await Promise.all([
        pc.setLocalDescription({ type: 'rollback' }),
        pc.setRemoteDescription(offer),
      ])
    } else {
      await pc.setRemoteDescription(offer)
    }
    await flushPendingIce(fromId, pc)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    if (callIdRef.current) {
      await sendCallSignal(callIdRef.current, fromId, 'answer', pc.localDescription).catch(() => {})
    }
  }, [createPeer, flushPendingIce])

  const handleAnswer = useCallback(async (fromId: number, answer: RTCSessionDescriptionInit) => {
    const entry = peersRef.current.get(fromId)
    if (!entry) return
    await entry.pc.setRemoteDescription(answer)
    await flushPendingIce(fromId, entry.pc)
  }, [flushPendingIce])

  const handleIce = useCallback(async (fromId: number, cand: RTCIceCandidateInit) => {
    const entry = peersRef.current.get(fromId)
    if (entry) {
      try {
        await entry.pc.addIceCandidate(cand)
      } catch (err) {
        if (!entry.ignoreOffer) throw err
      }
    } else {
      const q = pendingIceRef.current.get(fromId) ?? []
      q.push(cand)
      pendingIceRef.current.set(fromId, q)
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
        try {
          payload = JSON.parse(sig.payload)
        } catch {
          payload = sig.payload
        }

        try {
          if (sig.signal_type === 'offer') {
            await handleOffer(from, payload as RTCSessionDescriptionInit)
          } else if (sig.signal_type === 'answer') {
            await handleAnswer(from, payload as RTCSessionDescriptionInit)
          } else if (sig.signal_type === 'ice') {
            await handleIce(from, payload as RTCIceCandidateInit)
          } else if (sig.signal_type === 'bye') {
            cleanupPeer(from)
          }
        } catch {
          // ignore single-signal failures
        }
      }
    } catch {
      // ignore transient poll errors
    }
  }, [handleOffer, handleAnswer, handleIce, cleanupPeer])

  const pollMembers = useCallback(async () => {
    const cid = callIdRef.current
    if (!cid || !joinedRef.current) return
    try {
      const list = await getCallMembers(cid)
      setMembers(list)
      const ids = new Set(list.map((m) => m.user_id))
      for (const m of list) {
        if (!peersRef.current.has(m.user_id)) createPeer(m.user_id)
      }
      for (const peerId of [...peersRef.current.keys()]) {
        if (!ids.has(peerId)) cleanupPeer(peerId)
      }
    } catch {
      // ignore
    }
  }, [createPeer, cleanupPeer])

  const loadIceServers = useCallback(async () => {
    try {
      const cfg = await getCallConfig()
      if (cfg.ice_servers?.length) iceServersRef.current = cfg.ice_servers
    } catch {
      // keep default STUN
    }
  }, [])

  const startTimers = useCallback(() => {
    if (signalTimerRef.current) window.clearInterval(signalTimerRef.current)
    if (membersTimerRef.current) window.clearInterval(membersTimerRef.current)
    signalTimerRef.current = window.setInterval(pollSignals, SIGNAL_POLL_MS)
    membersTimerRef.current = window.setInterval(pollMembers, MEMBERS_POLL_MS)
  }, [pollSignals, pollMembers])

  const stopTimers = useCallback(() => {
    if (signalTimerRef.current) { window.clearInterval(signalTimerRef.current); signalTimerRef.current = null }
    if (membersTimerRef.current) { window.clearInterval(membersTimerRef.current); membersTimerRef.current = null }
  }, [])

  // Початковий стан: чи є активна розмова і скільки в ній людей (без приєднання).
  const refreshActive = useCallback(async () => {
    try {
      const data = await getActiveCall()
      if (data) {
        callIdRef.current = data.call_id
        if (!joinedRef.current) setMembers(data.members)
      } else if (!joinedRef.current) {
        callIdRef.current = null
        setMembers([])
      }
    } catch {
      // ignore
    }
  }, [])

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
      await loadIceServers()
      const res = await apiJoinCall()
      callIdRef.current = res.call_id
      afterIdRef.current = 0
      joinedRef.current = true
      setJoined(true)
      setMembers(res.members)
      for (const m of res.members) createPeer(m.user_id)
      startTimers()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося приєднатись до розмови.')
    } finally {
      setConnecting(false)
    }
  }, [loadIceServers, createPeer, startTimers])

  const leave = useCallback(async () => {
    const cid = callIdRef.current
    stopTimers()
    for (const [peerId] of peersRef.current) {
      if (cid) sendCallSignal(cid, peerId, 'bye', { bye: true }).catch(() => {})
    }
    cleanupAll()
    joinedRef.current = false
    micOnRef.current = false
    setJoined(false)
    setMicOn(false)
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
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        localStreamRef.current = stream
        const track = stream.getAudioTracks()[0]
        for (const [, entry] of peersRef.current) {
          const transceiver = entry.pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio')
          if (transceiver) {
            await transceiver.sender.replaceTrack(track)
            transceiver.direction = 'sendrecv'
          } else {
            entry.pc.addTrack(track, stream)
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          setError('Доступ до мікрофона заблоковано. Дозвольте мікрофон у налаштуваннях браузера.')
        } else if (err instanceof DOMException && err.name === 'NotFoundError') {
          setError('Мікрофон не знайдено на цьому пристрої.')
        } else {
          setError('Не вдалося увімкнути мікрофон.')
        }
        return
      }
    } else {
      const stream = localStreamRef.current
      for (const [, entry] of peersRef.current) {
        const transceiver = entry.pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio')
        if (transceiver) {
          await transceiver.sender.replaceTrack(null)
          transceiver.direction = 'recvonly'
        }
      }
      if (stream) {
        for (const t of stream.getTracks()) t.stop()
        localStreamRef.current = null
      }
    }

    micOnRef.current = next
    setMicOn(next)
    setCallMic(cid, next).catch(() => {})
  }, [])

  // Ведучий закрив вкладку — повідомляємо сервер, щоб нас прибрали зі списку.
  useEffect(() => {
    const handlePageHide = () => {
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

  useEffect(() => {
    return () => {
      stopTimers()
      cleanupAll()
    }
  }, [stopTimers, cleanupAll])

  return { members, joined, micOn, connecting, error, join, leave, toggleMic }
}
