import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  getBroadcastConfig,
  getBroadcastListeners,
  getLiveBroadcast,
  leaveBroadcast,
  listenBroadcast,
  pollBroadcastSignals,
  sendBroadcastSignal,
  startBroadcast as apiStartBroadcast,
  stopBroadcast as apiStopBroadcast,
  type LiveBroadcast,
} from './api'

const SIGNAL_POLL_MS = 1500
const LISTENERS_POLL_MS = 2500
const LIVE_POLL_MS = 4000

type Role = 'idle' | 'host' | 'listener'

type PeerEntry = {
  pc: RTCPeerConnection
  audio?: HTMLAudioElement
}

/**
 * Живий ефір (1 -> N). Ведучий (host) вмикає мікрофон і вещає; слухачі
 * лише приймають аудіо (мікрофон їм не потрібен — це й вирішує проблему
 * дозволу мікрофона на телефоні для більшості користувачів).
 */
export function useBroadcast(myUserId: number | null) {
  const [live, setLive] = useState<LiveBroadcast>(null)
  const [role, setRole] = useState<Role>('idle')
  const [connecting, setConnecting] = useState(false)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const broadcastIdRef = useRef<number | null>(null)
  const hostIdRef = useRef<number | null>(null)
  const roleRef = useRef<Role>('idle')
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<number, PeerEntry>>(new Map())
  const pendingIceRef = useRef<Map<number, RTCIceCandidateInit[]>>(new Map())
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }])
  const afterIdRef = useRef(0)
  const signalTimerRef = useRef<number | null>(null)
  const listenersTimerRef = useRef<number | null>(null)
  const liveTimerRef = useRef<number | null>(null)

  const setRoleBoth = useCallback((r: Role) => {
    roleRef.current = r
    setRole(r)
  }, [])

  const cleanupPeer = useCallback((userId: number) => {
    const entry = peersRef.current.get(userId)
    if (!entry) return
    entry.pc.close()
    if (entry.audio) {
      entry.audio.srcObject = null
      entry.audio.remove()
    }
    peersRef.current.delete(userId)
  }, [])

  const cleanupAll = useCallback(() => {
    for (const [, entry] of peersRef.current) {
      entry.pc.close()
      if (entry.audio) {
        entry.audio.srcObject = null
        entry.audio.remove()
      }
    }
    peersRef.current.clear()
    pendingIceRef.current.clear()
    if (localStreamRef.current) {
      for (const t of localStreamRef.current.getTracks()) t.stop()
      localStreamRef.current = null
    }
  }, [])

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

  // Host -> новий слухач: створюємо peer, додаємо мікрофон, шлемо offer.
  const createHostPeer = useCallback((listenerId: number) => {
    if (peersRef.current.has(listenerId)) return
    const bid = broadcastIdRef.current
    if (!bid) return

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })
    const stream = localStreamRef.current
    if (stream) {
      for (const track of stream.getTracks()) pc.addTrack(track, stream)
    }
    pc.onicecandidate = (e) => {
      if (e.candidate && broadcastIdRef.current) {
        sendBroadcastSignal(broadcastIdRef.current, listenerId, 'ice', e.candidate.toJSON()).catch(() => {})
      }
    }
    peersRef.current.set(listenerId, { pc })

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer).then(() => offer))
      .then((offer) => {
        if (broadcastIdRef.current) {
          return sendBroadcastSignal(broadcastIdRef.current, listenerId, 'offer', offer)
        }
      })
      .catch(() => {})
  }, [])

  // Слухач отримав offer від host: створюємо приймаючий peer (без мікрофона).
  const createListenerPeer = useCallback(async (hostId: number, offer: RTCSessionDescriptionInit) => {
    const bid = broadcastIdRef.current
    if (!bid) return
    cleanupPeer(hostId)

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })
    const audio = document.createElement('audio')
    audio.autoplay = true
    ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
    audio.setAttribute('playsinline', '')
    audio.style.display = 'none'
    document.body.appendChild(audio)

    pc.onicecandidate = (e) => {
      if (e.candidate && broadcastIdRef.current) {
        sendBroadcastSignal(broadcastIdRef.current, hostId, 'ice', e.candidate.toJSON()).catch(() => {})
      }
    }
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0]
      audio.play().catch(() => {})
    }

    peersRef.current.set(hostId, { pc, audio })

    await pc.setRemoteDescription(offer)
    await flushPendingIce(hostId, pc)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    if (broadcastIdRef.current) {
      await sendBroadcastSignal(bid, hostId, 'answer', answer).catch(() => {})
    }
  }, [cleanupPeer, flushPendingIce])

  const handleIce = useCallback(async (fromId: number, cand: RTCIceCandidateInit) => {
    const entry = peersRef.current.get(fromId)
    if (entry) {
      try {
        await entry.pc.addIceCandidate(cand)
      } catch {
        // ignore
      }
    } else {
      const q = pendingIceRef.current.get(fromId) ?? []
      q.push(cand)
      pendingIceRef.current.set(fromId, q)
    }
  }, [])

  const pollSignals = useCallback(async () => {
    const bid = broadcastIdRef.current
    if (!bid) return
    try {
      const signals = await pollBroadcastSignals(bid, afterIdRef.current)
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
          // Лише слухач очікує offer (від host).
          if (roleRef.current === 'listener') {
            await createListenerPeer(from, payload as RTCSessionDescriptionInit)
          }
        } else if (sig.signal_type === 'answer') {
          const entry = peersRef.current.get(from)
          if (entry) await entry.pc.setRemoteDescription(payload as RTCSessionDescriptionInit)
        } else if (sig.signal_type === 'ice') {
          await handleIce(from, payload as RTCIceCandidateInit)
        } else if (sig.signal_type === 'bye') {
          cleanupPeer(from)
        }
      }
    } catch {
      // ignore transient poll errors
    }
  }, [createListenerPeer, handleIce, cleanupPeer])

  // Host опитує список слухачів і відкриває peer кожному новому.
  const pollListeners = useCallback(async () => {
    const bid = broadcastIdRef.current
    if (!bid || roleRef.current !== 'host') return
    try {
      const list = await getBroadcastListeners(bid)
      const ids = new Set(list.map((l) => l.user_id))
      for (const l of list) {
        if (l.user_id !== myUserId && !peersRef.current.has(l.user_id)) {
          createHostPeer(l.user_id)
        }
      }
      // Слухач, що пішов — закриваємо peer.
      for (const peerId of [...peersRef.current.keys()]) {
        if (!ids.has(peerId)) cleanupPeer(peerId)
      }
    } catch {
      // ignore
    }
  }, [createHostPeer, cleanupPeer, myUserId])

  const refreshLive = useCallback(async () => {
    try {
      const data = await getLiveBroadcast()
      setLive(data)
      // Слухач: якщо ефір зник (host зупинив) — прибираємось.
      if (roleRef.current === 'listener' && !data) {
        cleanupAll()
        setRoleBoth('idle')
        broadcastIdRef.current = null
        if (signalTimerRef.current) {
          window.clearInterval(signalTimerRef.current)
          signalTimerRef.current = null
        }
      }
    } catch {
      // ignore
    }
  }, [cleanupAll, setRoleBoth])

  useEffect(() => {
    refreshLive()
    liveTimerRef.current = window.setInterval(refreshLive, LIVE_POLL_MS)
    return () => {
      if (liveTimerRef.current) window.clearInterval(liveTimerRef.current)
    }
  }, [refreshLive])

  const loadIceServers = useCallback(async () => {
    try {
      const cfg = await getBroadcastConfig()
      if (cfg.ice_servers?.length) iceServersRef.current = cfg.ice_servers
    } catch {
      // keep default STUN
    }
  }, [])

  const startSignalLoop = useCallback(() => {
    if (signalTimerRef.current) window.clearInterval(signalTimerRef.current)
    signalTimerRef.current = window.setInterval(pollSignals, SIGNAL_POLL_MS)
  }, [pollSignals])

  // ── Ведучий ────────────────────────────────────────────────────────────────
  const start = useCallback(async (title: string) => {
    setError(null)
    setConnecting(true)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Цей браузер не підтримує мікрофон. Відкрийте сайт у Safari/Chrome (не у вбудованому браузері застосунку).')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localStreamRef.current = stream
      await loadIceServers()

      const res = await apiStartBroadcast(title)
      broadcastIdRef.current = res.broadcast_id
      afterIdRef.current = 0
      setMuted(false)
      setRoleBoth('host')

      startSignalLoop()
      if (listenersTimerRef.current) window.clearInterval(listenersTimerRef.current)
      listenersTimerRef.current = window.setInterval(pollListeners, LISTENERS_POLL_MS)
      await pollListeners()
      await refreshLive()
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Доступ до мікрофона заблоковано. Дозвольте мікрофон для цього сайту в налаштуваннях браузера.')
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setError('Мікрофон не знайдено на цьому пристрої.')
      } else {
        setError('Не вдалося почати ефір.')
      }
      cleanupAll()
    } finally {
      setConnecting(false)
    }
  }, [loadIceServers, startSignalLoop, pollListeners, refreshLive, setRoleBoth, cleanupAll])

  const stop = useCallback(async () => {
    const bid = broadcastIdRef.current
    if (signalTimerRef.current) { window.clearInterval(signalTimerRef.current); signalTimerRef.current = null }
    if (listenersTimerRef.current) { window.clearInterval(listenersTimerRef.current); listenersTimerRef.current = null }
    for (const [peerId] of peersRef.current) {
      if (bid) sendBroadcastSignal(bid, peerId, 'bye', { bye: true }).catch(() => {})
    }
    cleanupAll()
    setRoleBoth('idle')
    broadcastIdRef.current = null
    if (bid) {
      try { await apiStopBroadcast(bid) } catch { /* ignore */ }
    }
    await refreshLive()
  }, [cleanupAll, setRoleBoth, refreshLive])

  // ── Слухач ───────────────────────────────────────────────────────────────
  const listen = useCallback(async (broadcastId: number) => {
    setError(null)
    setConnecting(true)
    try {
      await loadIceServers()
      const res = await listenBroadcast(broadcastId)
      broadcastIdRef.current = broadcastId
      hostIdRef.current = res.host_user_id
      afterIdRef.current = 0
      setRoleBoth('listener')
      startSignalLoop()
      await refreshLive()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося приєднатись до ефіру.')
    } finally {
      setConnecting(false)
    }
  }, [loadIceServers, startSignalLoop, refreshLive, setRoleBoth])

  const stopListening = useCallback(async () => {
    const bid = broadcastIdRef.current
    const hostId = hostIdRef.current
    if (signalTimerRef.current) { window.clearInterval(signalTimerRef.current); signalTimerRef.current = null }
    if (bid && hostId) sendBroadcastSignal(bid, hostId, 'bye', { bye: true }).catch(() => {})
    cleanupAll()
    setRoleBoth('idle')
    broadcastIdRef.current = null
    hostIdRef.current = null
    if (bid) {
      try { await leaveBroadcast(bid) } catch { /* ignore */ }
    }
    await refreshLive()
  }, [cleanupAll, setRoleBoth, refreshLive])

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return
    const next = !muted
    for (const track of stream.getAudioTracks()) track.enabled = !next
    setMuted(next)
  }, [muted])

  useEffect(() => {
    return () => {
      if (signalTimerRef.current) window.clearInterval(signalTimerRef.current)
      if (listenersTimerRef.current) window.clearInterval(listenersTimerRef.current)
      if (liveTimerRef.current) window.clearInterval(liveTimerRef.current)
      cleanupAll()
    }
  }, [cleanupAll])

  return { live, role, connecting, muted, error, start, stop, listen, stopListening, toggleMute }
}
