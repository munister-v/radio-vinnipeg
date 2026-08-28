import { useEffect, useRef } from 'react'
import type { NowPlaying } from './api'

/*
  Плеєр монтується РІВНО один раз на відео.

  Було: <iframe src="...&start={position_sec}"> усередині компонента, який
  опитує сервер кожні 4 с. Кожна відповідь несе новий position_sec → новий src →
  браузер перезавантажував iframe і відео смикалося з початку позиції.

  Стало: iframe створює IFrame API, а синхронізація йде командами seekTo/playVideo
  по вже завантаженому плеєру. Перезавантаження лише при зміні video_id.
*/

type YTPlayer = {
  loadVideoById: (o: { videoId: string; startSeconds?: number }) => void
  seekTo: (s: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getPlayerState: () => number
  playVideo: () => void
  pauseVideo: () => void
  destroy: () => void
}

declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<void> | null = null

function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (apiPromise) return apiPromise
  apiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve() }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    document.head.appendChild(s)
  })
  return apiPromise
}

/* Розсинхрон, більший за це, вирівнюємо; менший лишаємо, щоб не смикати. */
const DRIFT_TOLERANCE_SEC = 4

export function useYouTubePlayer(np: NowPlaying) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const readyRef = useRef(false)
  const videoIdRef = useRef<string | null>(null)
  const npRef = useRef<NowPlaying>(np)
  npRef.current = np

  const videoId = np?.video_id || null

  // Створення/знищення плеєра. Залежність лише від наявності відео,
  // тому опитування now-playing плеєр не чіпає.
  useEffect(() => {
    if (!videoId) {
      playerRef.current?.destroy()
      playerRef.current = null
      readyRef.current = false
      videoIdRef.current = null
      return
    }
    if (playerRef.current) return

    let cancelled = false
    const startId = videoId
    const startAt = Math.max(0, Math.floor(npRef.current?.position_sec ?? 0))

    loadApi().then(() => {
      if (cancelled || !hostRef.current) return
      videoIdRef.current = startId
      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId: startId,
        playerVars: {
          autoplay: 1, start: startAt, playsinline: 1,
          modestbranding: 1, rel: 0, origin: window.location.origin,
        },
        events: {
          onReady: () => { readyRef.current = true },
        },
      }) as YTPlayer
    })

    return () => { cancelled = true }
  }, [!!videoId])

  // Синхронізація з сервером без перезавантаження iframe.
  useEffect(() => {
    const p = playerRef.current
    if (!p || !readyRef.current || !np?.video_id) return

    if (videoIdRef.current !== np.video_id) {
      videoIdRef.current = np.video_id
      p.loadVideoById({ videoId: np.video_id, startSeconds: Math.max(0, Math.floor(np.position_sec)) })
      return
    }

    let current = 0
    try { current = p.getCurrentTime() } catch { return }
    if (Math.abs(current - np.position_sec) > DRIFT_TOLERANCE_SEC) {
      p.seekTo(np.position_sec, true)
    }

    // 1 = playing, 2 = paused
    let state = -1
    try { state = p.getPlayerState() } catch { /* плеєр ще не готовий */ }
    if (np.is_playing && state === 2) p.playVideo()
    if (!np.is_playing && state === 1) p.pauseVideo()
  }, [np?.video_id, np?.position_sec, np?.is_playing])

  useEffect(() => () => { playerRef.current?.destroy(); playerRef.current = null }, [])

  return hostRef
}
