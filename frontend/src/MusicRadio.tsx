import { useEffect, useRef, useState } from 'react'
import './music-radio.css'

/* ────────────────────────────────────────────────────────────────────────
   Music Radio — public Icecast streams, no backend, no signup.
   70s / 80s / 90s classic pop, rock, soul and late-night radio.
   ──────────────────────────────────────────────────────────────────────── */

const STATIONS = [
  {
    id: 'u80s',
    name: 'Underground 80s',
    desc: 'Post-punk, new wave, synth-pop — the underground side of the 80s',
    url: 'https://ice4.somafm.com/u80s-128-mp3',
    tag: '80s',
    color: '#c6a15c',
    provider: 'SomaFM',
  },
  {
    id: 'rp-main',
    name: 'Paradise Mix',
    desc: 'Classic rock, pop, world and deep cuts — Doors / Sting territory',
    url: 'https://stream.radioparadise.com/aac-320',
    tag: 'classic',
    color: '#d65d3f',
    provider: 'Radio Paradise',
  },
  {
    id: 'rp-rock',
    name: 'Paradise Rock',
    desc: 'Album rock and guitar classics for The Doors, Police, Bowie moods',
    url: 'https://stream.radioparadise.com/rock-320',
    tag: 'rock',
    color: '#b44e88',
    provider: 'Radio Paradise',
  },
  {
    id: 'rp-mellow',
    name: 'Paradise Mellow',
    desc: 'Softer classic pop and late-night singer-songwriter radio',
    url: 'https://stream.radioparadise.com/mellow-320',
    tag: 'mellow',
    color: '#4f83c5',
    provider: 'Radio Paradise',
  },
  {
    id: 'rp-global',
    name: 'Paradise Global',
    desc: 'Global grooves, classic discoveries and road-trip radio',
    url: 'https://stream.radioparadise.com/global-320',
    tag: 'global',
    color: '#4fa38c',
    provider: 'Radio Paradise',
  },
  {
    id: 'rp-eclectic',
    name: 'Paradise Eclectic',
    desc: 'A wider crate: rock, soul, world, electronic and surprises',
    url: 'https://stream.radioparadise.com/eclectic-320',
    tag: 'deep cuts',
    color: '#9b6fc8',
    provider: 'Radio Paradise',
  },
  {
    id: 'poptron',
    name: 'PopTron',
    desc: 'Indie pop & synthpop from 80s through today',
    url: 'https://ice4.somafm.com/poptron-128-mp3',
    tag: '80s–90s',
    color: '#7daa6e',
    provider: 'SomaFM',
  },
  {
    id: 'seventies',
    name: 'Left Coast 70s',
    desc: 'Mellow album rock, AM gold and California 70s sunshine',
    url: 'https://ice4.somafm.com/seventies-128-mp3',
    tag: '70s',
    color: '#d09a4b',
    provider: 'SomaFM',
  },
  {
    id: '7soul',
    name: 'Seven Inch Soul',
    desc: 'Vintage 45s, Motown-adjacent soul and dancefloor oldies',
    url: 'https://ice4.somafm.com/7soul-128-mp3',
    tag: '60s-70s',
    color: '#bf6b5a',
    provider: 'SomaFM',
  },
  {
    id: 'secretagent',
    name: 'Secret Agent',
    desc: 'Suave spy jazz, lounge and bossa — retro movie vibes',
    url: 'https://ice4.somafm.com/secretagent-128-mp3',
    tag: '60s–70s',
    color: '#8a7bbf',
    provider: 'SomaFM',
  },
  {
    id: 'beatblender',
    name: 'Beat Blender',
    desc: 'Late-night electronic, downtempo, chill beats',
    url: 'https://ice4.somafm.com/beatblender-128-mp3',
    tag: '90s–00s',
    color: '#5d9cb5',
    provider: 'SomaFM',
  },
] as const

type Station = typeof STATIONS[number]

function WaveAnim({ active }: { active: boolean }) {
  return (
    <div className={`mr-wave ${active ? 'on' : ''}`} aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => (
        <i key={i} style={{ animationDelay: `${i * 0.08}s` }} />
      ))}
    </div>
  )
}

export default function MusicRadio() {
  const [active, setActive] = useState<Station | null>(null)
  const [playing, setPlaying] = useState(false)
  const [vol, setVol] = useState(0.8)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const noSleepRef = useRef<HTMLAudioElement | null>(null)
  const activeRef = useRef<Station | null>(null)
  const userStoppedRef = useRef(true)
  const reconnectTimerRef = useRef<number | null>(null)

  const clearReconnect = () => {
    if (reconnectTimerRef.current === null) return
    window.clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = null
  }

  const disposeAudio = () => {
    clearReconnect()
    const audio = audioRef.current
    audioRef.current = null
    if (!audio) return
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }

  // NoSleep WAV for iOS lock screen
  const startNoSleep = () => {
    if (noSleepRef.current) return
    try {
      const wav = new Uint8Array([0x52,0x49,0x46,0x46,0x25,0x00,0x00,0x00,0x57,0x41,0x56,0x45,0x66,0x6d,0x74,0x20,0x10,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x40,0x1f,0x00,0x00,0x40,0x1f,0x00,0x00,0x01,0x00,0x08,0x00,0x64,0x61,0x74,0x61,0x01,0x00,0x00,0x00,0x80])
      const el = new Audio(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })))
      el.loop = true; el.volume = 0.001; el.setAttribute('playsinline', '')
      document.body.appendChild(el); noSleepRef.current = el; el.play().catch(() => {})
    } catch {}
  }

  const stopNoSleep = () => {
    if (!noSleepRef.current) return
    noSleepRef.current.pause(); noSleepRef.current.src = ''; noSleepRef.current.remove(); noSleepRef.current = null
  }

  const stop = () => {
    userStoppedRef.current = true
    activeRef.current = null
    disposeAudio()
    setPlaying(false); setLoading(false); setError(null)
    stopNoSleep()
    if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = 'none' } catch {} }
  }

  const scheduleReconnect = (station: Station) => {
    if (userStoppedRef.current || reconnectTimerRef.current !== null) return
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null
      if (!userStoppedRef.current && activeRef.current?.id === station.id) play(station)
    }, 1400)
  }

  const play = (station: Station) => {
    userStoppedRef.current = false
    disposeAudio()
    activeRef.current = station
    setActive(station); setLoading(true); setError(null)
    startNoSleep()

    const audio = new Audio(station.url)
    audio.volume = vol
    audio.preload = 'none'
    audio.setAttribute('playsinline', '')
    ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
    audioRef.current = audio

    const markPlaying = () => {
      if (audioRef.current !== audio) return
      setLoading(false)
      setPlaying(true)
      setError(null)
    }
    audio.addEventListener('canplay', markPlaying, { once: true })
    audio.addEventListener('playing', markPlaying)
    audio.addEventListener('error', () => {
      if (userStoppedRef.current || audioRef.current !== audio) return
      setLoading(false); setError('Reconnecting stream…'); setPlaying(false); scheduleReconnect(station)
    })
    audio.addEventListener('stalled', () => { if (audioRef.current === audio) scheduleReconnect(station) })
    audio.addEventListener('ended', () => { if (audioRef.current === audio) scheduleReconnect(station) })
    audio.addEventListener('pause', () => {
      if (audioRef.current === audio && !userStoppedRef.current) audio.play().catch(() => {})
    })
    audio.play()
      .then(markPlaying)
      .catch(() => { setLoading(false); setError('Playback blocked — tap again') })

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: station.name, artist: station.provider, album: station.desc,
        })
        navigator.mediaSession.playbackState = 'playing'
        const resume = () => { if (audioRef.current && !userStoppedRef.current) audioRef.current.play().catch(() => {}) }
        const next = () => {
          const i = STATIONS.findIndex((s) => s.id === station.id)
          play(STATIONS[(i + 1) % STATIONS.length])
        }
        const previous = () => {
          const i = STATIONS.findIndex((s) => s.id === station.id)
          play(STATIONS[(i - 1 + STATIONS.length) % STATIONS.length])
        }
        navigator.mediaSession.setActionHandler('play', resume)
        navigator.mediaSession.setActionHandler('pause', resume)
        try { navigator.mediaSession.setActionHandler('stop', stop) } catch {}
        try { navigator.mediaSession.setActionHandler('nexttrack', next) } catch {}
        try { navigator.mediaSession.setActionHandler('previoustrack', previous) } catch {}
      } catch {}
    }
  }

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = vol
  }, [vol])

  useEffect(() => {
    const keepAlive = () => {
      const audio = audioRef.current
      if (!audio || userStoppedRef.current || !active) return
      if (audio.paused || audio.readyState < 2) audio.play().catch(() => scheduleReconnect(active))
    }
    document.addEventListener('visibilitychange', keepAlive)
    window.addEventListener('online', keepAlive)
    window.addEventListener('focus', keepAlive)
    return () => {
      document.removeEventListener('visibilitychange', keepAlive)
      window.removeEventListener('online', keepAlive)
      window.removeEventListener('focus', keepAlive)
    }
  }, [active])

  useEffect(() => () => { stop() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="mr-root" id="music">
      <header className="mr-header">
        <div className="mr-header-text">
          <span className="mr-eyebrow">Free Public Radio</span>
          <h2 className="mr-title">Music Radio</h2>
          <p className="mr-sub">70s, 80s &amp; 90s pop, rock and soul — streaming live, no ads</p>
        </div>
        {playing && active && (
          <div className="mr-now">
            <WaveAnim active />
            <span className="mr-now-name">{active.name}</span>
            <button className="mr-stop-all" onClick={stop} aria-label="Stop">■ Stop</button>
          </div>
        )}
      </header>

      <div className="mr-grid">
        {STATIONS.map((s) => {
          const isActive = active?.id === s.id
          const isLoading = isActive && loading
          const isPlaying = isActive && playing
          return (
            <div
              key={s.id}
              className={`mr-card ${isActive ? 'active' : ''}`}
              style={{ '--mr-color': s.color } as React.CSSProperties}
            >
              <div className="mr-card-top">
                <span className="mr-tag">{s.tag}</span>
                <WaveAnim active={isPlaying} />
              </div>
              <h3 className="mr-card-name">{s.name}</h3>
              <p className="mr-card-desc">{s.desc}</p>
              {isActive && error && <p className="mr-card-err">{error}</p>}
              <button
                className={`mr-play ${isPlaying ? 'on' : ''} ${isLoading ? 'loading' : ''}`}
                onClick={() => isPlaying ? stop() : play(s)}
                disabled={isLoading}
                aria-label={isPlaying ? 'Stop' : `Play ${s.name}`}
              >
                <span
                  className={`mr-play-icon ${isLoading ? 'loading' : isPlaying ? 'pause' : 'play'}`}
                  aria-hidden
                />
              </button>
            </div>
          )
        })}
      </div>

      {/* Volume */}
      {playing && (
        <div className="mr-vol-row">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M11 5L6 9H3v6h3l5 4V5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <input type="range" min="0" max="1" step="0.02" value={vol}
            onChange={(e) => setVol(parseFloat(e.target.value))} aria-label="Volume" />
          <span>{Math.round(vol * 100)}%</span>
        </div>
      )}

      <p className="mr-credit">
        Streams provided by <a href="https://somafm.com" target="_blank" rel="noopener">SomaFM</a> and <a href="https://radioparadise.com" target="_blank" rel="noopener">Radio Paradise</a> — independent, listener-supported, non-commercial.
      </p>
    </section>
  )
}
