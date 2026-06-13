import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  getActiveCall,
  getCallConfig,
  joinCall,
  leaveCall,
  pollCallSignals,
  sendCallSignal,
  type ActiveCall,
  type CallMember,
} from './api'

const SIGNAL_POLL_MS = 1500
const ACTIVE_POLL_MS = 4000

type PeerEntry = {
  pc: RTCPeerConnection
  audio: HTMLAudioElement
}

export function useCall(myUserId: number) {
  const [active, setActive] = useState<ActiveCall>(null)
  const [joined, setJoined] = useState(false)
  const [members, setMembers] = useState<CallMember[]>([])
  const [muted, setMuted] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const callIdRef = useRef<number | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<number, PeerEntry>>(new Map())
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }])
  const afterIdRef = useRef(0)
  const signalTimerRef = useRef<number | null>(null)
  const activeTimerRef = useRef<number | null>(null)
  const joinedRef = useRef(false)

  const cleanupPeer = useCallback((userId: number) => {
    const entry = peersRef.current.get(userId)
    if (!entry) return
    entry.pc.close()
    entry.audio.srcObject = null
    entry.audio.remove()
    peersRef.current.delete(userId)
  }, [])

  const createPeer = useCallback(
    (userId: number, isOfferer: boolean) => {
      const existing = peersRef.current.get(userId)
      if (existing) return existing.pc

      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })
      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.style.display = 'none'
      document.body.appendChild(audio)

      const stream = localStreamRef.current
      if (stream) {
        for (const track of stream.getTracks()) pc.addTrack(track, stream)
      }

      pc.onicecandidate = (e) => {
        if (e.candidate && callIdRef.current) {
          sendCallSignal(callIdRef.current, userId, 'ice', e.candidate.toJSON()).catch(() => {})
        }
      }

      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0]
        audio.play().catch(() => {})
      }

      peersRef.current.set(userId, { pc, audio })

      if (isOfferer) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer).then(() => offer))
          .then((offer) => {
            if (callIdRef.current) {
              sendCallSignal(callIdRef.current, userId, 'offer', offer).catch(() => {})
            }
          })
          .catch(() => {})
      }

      return pc
    },
    [],
  )

  const stopSignalPoll = useCallback(() => {
    if (signalTimerRef.current) {
      window.clearInterval(signalTimerRef.current)
      signalTimerRef.current = null
    }
  }, [])

  const pollSignals = useCallback(async () => {
    const callId = callIdRef.current
    if (!callId) return
    try {
      const signals = await pollCallSignals(callId, afterIdRef.current)
      for (const sig of signals) {
        afterIdRef.current = sig.id
        const from = sig.from_user_id
        let payload: unknown = null
        try {
          payload = JSON.parse(sig.payload)
        } catch {
          payload = sig.payload
        }

        if (sig.signal_type === 'offer') {
          const pc = createPeer(from, false)
          await pc.setRemoteDescription(payload as RTCSessionDescriptionInit)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          await sendCallSignal(callId, from, 'answer', answer).catch(() => {})
        } else if (sig.signal_type === 'answer') {
          const entry = peersRef.current.get(from)
          if (entry) await entry.pc.setRemoteDescription(payload as RTCSessionDescriptionInit)
        } else if (sig.signal_type === 'ice') {
          const entry = peersRef.current.get(from)
          if (entry) {
            try {
              await entry.pc.addIceCandidate(payload as RTCIceCandidateInit)
            } catch {
              // ignore
            }
          }
        } else if (sig.signal_type === 'bye') {
          cleanupPeer(from)
        }
      }
    } catch {
      // ignore transient poll errors
    }
  }, [createPeer, cleanupPeer])

  const refreshActive = useCallback(async () => {
    try {
      const data = await getActiveCall()
      setActive(data)
      if (data) setMembers(data.members)
      if (data && !joinedRef.current) {
        // keep banner in sync
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    refreshActive()
    activeTimerRef.current = window.setInterval(refreshActive, ACTIVE_POLL_MS)
    return () => {
      if (activeTimerRef.current) window.clearInterval(activeTimerRef.current)
    }
  }, [refreshActive])

  const join = useCallback(async () => {
    setError(null)
    setConnecting(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Цей браузер не підтримує доступ до мікрофона. Відкрийте сайт у Safari/Chrome (не у вбудованому браузері застосунку).')
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localStreamRef.current = stream

      try {
        const cfg = await getCallConfig()
        if (cfg.ice_servers?.length) iceServersRef.current = cfg.ice_servers
      } catch {
        // keep default STUN
      }

      const res = await joinCall()
      callIdRef.current = res.call_id
      afterIdRef.current = 0
      joinedRef.current = true
      setJoined(true)
      setMembers((prev) => {
        const others = res.members
        const me = prev.find((m) => m.user_id === myUserId)
        return me ? [...others, me] : others
      })

      for (const m of res.members) {
        createPeer(m.user_id, true)
      }

      signalTimerRef.current = window.setInterval(pollSignals, SIGNAL_POLL_MS)
      await refreshActive()
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError') {
          setError('Доступ до мікрофона заблоковано. Дозволь мікрофон для цього сайту в налаштуваннях браузера і спробуй ще раз.')
        } else if (err.name === 'NotFoundError') {
          setError('Мікрофон не знайдено на цьому пристрої.')
        } else {
          setError('Не вдалося отримати доступ до мікрофона.')
        }
      } else {
        setError('Не вдалося приєднатись до дзвінка.')
      }
      if (localStreamRef.current) {
        for (const t of localStreamRef.current.getTracks()) t.stop()
        localStreamRef.current = null
      }
    } finally {
      setConnecting(false)
    }
  }, [createPeer, pollSignals, refreshActive, myUserId])

  const leave = useCallback(async () => {
    const callId = callIdRef.current
    stopSignalPoll()

    for (const [userId, entry] of peersRef.current.entries()) {
      if (callId) sendCallSignal(callId, userId, 'bye', { bye: true }).catch(() => {})
      entry.pc.close()
      entry.audio.srcObject = null
      entry.audio.remove()
    }
    peersRef.current.clear()

    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop()
      localStreamRef.current = null
    }

    if (callId) {
      try {
        await leaveCall(callId)
      } catch {
        // ignore
      }
    }

    callIdRef.current = null
    joinedRef.current = false
    setJoined(false)
    setMuted(false)
    await refreshActive()
  }, [stopSignalPoll, refreshActive])

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return
    const next = !muted
    for (const track of stream.getAudioTracks()) track.enabled = !next
    setMuted(next)
  }, [muted])

  useEffect(() => {
    return () => {
      stopSignalPoll()
      if (activeTimerRef.current) window.clearInterval(activeTimerRef.current)
      for (const entry of peersRef.current.values()) {
        entry.pc.close()
        entry.audio.remove()
      }
      peersRef.current.clear()
      if (localStreamRef.current) {
        for (const t of localStreamRef.current.getTracks()) t.stop()
      }
    }
  }, [])

  return { active, joined, members, muted, connecting, error, join, leave, toggleMute }
}
