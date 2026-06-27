import { useEffect, useRef, useState } from 'react'
import './music-radio.css'

/* ────────────────────────────────────────────────────────────────────────
   Music Radio — SomaFM public Icecast streams, no backend, no signup.
   80s / 90s American & British hits, free for listeners.
   ──────────────────────────────────────────────────────────────────────── */

const STATIONS = [
  {
    id: 'u80s',
    name: 'Underground 80s',
    desc: 'Post-punk, new wave, synth-pop — the underground side of the 80s',
    url: 'https://ice4.somafm.com/u80s-128-mp3',
    tag: '80s',
    color: '#c6a15c',
  },
  {
    id: 'poptron',
    name: 'PopTron',
    desc: 'Indie pop & synthpop from 80s through today',
    url: 'https://ice4.somafm.com/poptron-128-mp3',
    tag: '80s–90s',
    color: '#7daa6e',
  },
  {
    id: 'secretagent',
    name: 'Secret Agent',
    desc: 'Suave spy jazz, lounge and bossa — retro movie vibes',
    url: 'https://ice4.somafm.com/secretagent-128-mp3',
    tag: '60s–70s',
    color: '#8a7bbf',
  },
  {
    id: 'beatblender',
    name: 'Beat Blender',
    desc: 'Late-night electronic, downtempo, chill beats',
    url: 'https://ice4.somafm.com/beatblender-128-mp3',
    tag: '90s–00s',
    color: '#5d9cb5',
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
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = '' }
    setPlaying(false); setLoading(false); setError(null)
    stopNoSleep()
    if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = 'none' } catch {} }
  }

  const play = (station: Station) => {
    stop()
    setActive(station); setLoading(true); setError(null)
    startNoSleep()

    const audio = new Audio(station.url)
    audio.volume = vol
    audio.setAttribute('playsinline', '')
    ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
    audioRef.current = audio

    audio.addEventListener('canplay', () => { setLoading(false); setPlaying(true) }, { once: true })
    audio.addEventListener('error', () => { setLoading(false); setError('Stream unavailable — try another station'); setPlaying(false) }, { once: true })
    audio.addEventListener('pause', () => { if (audioRef.current === audio) audio.play().catch(() => {}) })
    audio.play().catch(() => { setLoading(false); setError('Playback blocked — tap again') })

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: station.name, artist: 'SomaFM', album: station.desc,
        })
        navigator.mediaSession.playbackState = 'playing'
        const resist = () => { try { navigator.mediaSession.playbackState = 'playing' } catch {} }
        navigator.mediaSession.setActionHandler('play', resist)
        navigator.mediaSession.setActionHandler('pause', resist)
        try { navigator.mediaSession.setActionHandler('stop', resist) } catch {}
      } catch {}
    }
  }

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = vol
  }, [vol])

  useEffect(() => () => { stop() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="mr-root" id="music">
      <header className="mr-header">
        <div className="mr-header-text">
          <span className="mr-eyebrow">SomaFM · Free Public Radio</span>
          <h2 className="mr-title">Music Radio</h2>
          <p className="mr-sub">80s &amp; 90s American &amp; British — streaming live, no ads</p>
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
                {isLoading ? '…' : isPlaying ? '■' : '▶'}
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
        Streams provided by <a href="https://somafm.com" target="_blank" rel="noopener">SomaFM</a> — independent, listener-supported, non-commercial.
      </p>
    </section>
  )
}
