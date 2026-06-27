import { useEffect, useRef, useState } from 'react'
import type { User, NowPlaying } from './api'
import { getNowPlaying, setNowPlaying } from './api'
import SettingsPanel from './SettingsPanel'
import { useSettings } from './useSettings'
import { useVoice } from './useVoice'
import type { VoiceStats } from './VoicePanel'
import { useI18n, peopleWord } from './i18n'
import './forest.css'

/* Deterministic pine-forest silhouette — three depth layers */
function pinePath(count: number, minH: number, maxH: number, seed: number): string {
  const W = 1440, H = 400
  const step = W / count
  const hs = Array.from({ length: count }, (_, i) => {
    const n = (Math.sin(seed + i * 2.618) + Math.sin(seed * 1.73 + i * 1.414)) * 0.5
    return minH + (n * 0.5 + 0.5) * (maxH - minH)
  })
  let d = `M0,${H}`
  hs.forEach((h, i) => {
    const prev = i > 0 ? hs[i - 1] : h
    const valX = (i * step).toFixed(1)
    const valY = (H - Math.min(h, prev) * 0.72).toFixed(1)
    const pkX  = (i * step + step * 0.5).toFixed(1)
    const pkY  = (H - h).toFixed(1)
    d += ` L${valX},${valY} L${pkX},${pkY}`
  })
  return d + ` L${W},${H} Z`
}

function PineTrees() {
  const far  = pinePath(52, 28, 68,  1.1)
  const mid  = pinePath(34, 72, 148, 3.7)
  const near = pinePath(22, 140, 230, 6.2)
  return (
    <div className="fx-pines" aria-hidden>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 400" preserveAspectRatio="xMidYMax slice">
        <path d={far}  fill="rgba(48, 53, 66, 0.65)" />
        <path d={mid}  fill="rgba(22, 25, 32, 0.92)" />
        <path d={near} fill="rgba(6, 7, 10, 0.99)" />
      </svg>
    </div>
  )
}

function PlayGlyph() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.4l12 6.6-12 6.6V5.4Z" /></svg>
}
function MicGlyph({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 4.5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0v-6Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {off && <path d="M3.5 3.5l17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  )
}
function VolGlyph({ muted }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M11 5L6 9H3v6h3l5 4V5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      {!muted && <path d="M15.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
      {muted && <path d="M19 9l-6 6M13 9l6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
    </svg>
  )
}
function GearGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

export default function ForestStage({ user, onStats, room = 'lounge' }: { user: User; onStats?: (s: VoiceStats) => void; room?: string }) {
  const { t, lang } = useI18n()
  const settings = useSettings()
  const { members, joined, micOn, connecting, error, speaking, quality, connStats, audioBlocked, unlockAudio, join, leave, toggleMic } =
    useVoice(user.id, { volume: settings.volume, micDeviceId: settings.micDeviceId, room })

  // Now Playing
  const [np, setNp] = useState<NowPlaying>(null)
  const [npInput, setNpInput] = useState('')
  const [npOpen, setNpOpen] = useState(false)
  const npRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setNp(null)
    setNpInput('')
    const load = () => getNowPlaying(room).then(setNp).catch(() => {})
    load()
    const t = window.setInterval(load, 4000)
    return () => { window.clearInterval(t); if (npRef.current) clearTimeout(npRef.current) }
  }, [room])

  const onStatsRef = useRef(onStats)
  useEffect(() => { onStatsRef.current = onStats })
  useEffect(() => {
    if (!joined || !quality) { onStatsRef.current?.(null); return }
    onStatsRef.current?.({ quality, rttMs: connStats.rttMs, lossPercent: connStats.lossPercent })
  }, [joined, quality, connStats.rttMs, connStats.lossPercent])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pttHeld, setPttHeld] = useState(false)
  const pttBusyRef = useRef(false)

  const total = members.length + (joined ? 1 : 0)
  const speakers = members.filter((m) => m.speaking)
  const someoneSpeaking = speakers.length > 0 || (joined && micOn && speaking)
  const active = joined || members.length > 0

  // Schedule slots (mirror RadioPage) → drives the tile rail + channel 2
  const SLOT_STARTS = [0, 8, 12, 18]
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const id = window.setInterval(() => setHour(new Date().getHours()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const activeSlot = SLOT_STARTS.reduce((acc, s, i) => (hour >= s ? i : acc), 0)
  const nextSlot = (activeSlot + 1) % SLOT_STARTS.length
  const pad2 = (n: number) => String(n % 24).padStart(2, '0')

  // PTT (Space) у режимі рації
  useEffect(() => {
    if (!joined || !settings.pttMode) return
    const dn = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      if (!pttBusyRef.current && !micOn) {
        pttBusyRef.current = true; setPttHeld(true)
        toggleMic().finally(() => { pttBusyRef.current = false })
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (pttHeld && micOn) { setPttHeld(false); toggleMic() }
    }
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
  }, [joined, settings.pttMode, micOn, pttHeld, toggleMic])


  return (
    <section className="fx-stage" id="air">
      {/* ════ Dual-channel LIVE NOW bar — NTS signature ════ */}
      <div className="fx-livebar">
        <span className="fx-lb-label">
          <span className={`fx-lb-dot ${active ? 'on' : ''}`} aria-hidden />
          Live now
        </span>

        {/* Channel 1 — the open broadcast */}
        <button className="fx-chan" onClick={joined ? undefined : join} disabled={connecting}>
          <span className="fx-chan-n">1</span>
          <PlayGlyph />
          <span className="fx-chan-title">
            {active ? 'Winnipeg Nights · on air' : 'Winnipeg Nights · open mic'}
          </span>
          <span className="fx-chan-loc">Winnipeg</span>
        </button>

        {/* Channel 2 — scheduled programme */}
        <a className="fx-chan fx-chan-2" href="#schedule">
          <span className="fx-chan-n">2</span>
          <span className="fx-chan-title">{t(`slot.${activeSlot}.label`)}</span>
          <span className="fx-chan-loc">94.7 FM</span>
        </a>

        <span className="fx-lb-tail">{total} {peopleWord(total, lang)}</span>
      </div>

      {/* ════ Two-column grid: featured cell + tile rail ════ */}
      <div className="fx-grid">
        {/* ── Featured live cell (the "artwork") ── */}
        <div className="fx-feature">
          <div className="fx-moon" aria-hidden />
          <PineTrees />

          <div className="fx-deck">
            {!joined ? (
              <div className="fx-deck-idle">
                <button
                  className="fx-play"
                  onClick={join}
                  disabled={connecting}
                  aria-label={members.length ? t('voice.join') : t('voice.start')}
                >
                  <span className={`fx-play-ring r1 ${active ? 'on' : ''}`} aria-hidden />
                  <span className={`fx-play-ring r2 ${active ? 'on' : ''}`} aria-hidden />
                  <span className={`fx-play-ring r3 ${active ? 'on' : ''}`} aria-hidden />
                  <PlayGlyph />
                </button>
                <div className="fx-deck-text">
                  <span className="fx-deck-kicker">
                    {connecting ? t('voice.connecting') : members.length ? t('voice.join') : 'Курорт · 94.7 FM'}
                  </span>
                  <h1 className="fx-deck-title">Winnipeg Nights</h1>
                  <p className="fx-deck-desc">{t('hero.tagline')}</p>
                </div>
              </div>
            ) : (
              <div className="fx-deck-live">
                <div className="fx-deck-livehead">
                  <span className="fx-deck-live-title">Winnipeg Nights</span>
                  <span className="fx-deck-live-status">
                    {t('voice.inCallYou', { n: total, ppl: peopleWord(total, lang) })}
                  </span>
                  <button className="fx-gear" onClick={() => setSettingsOpen((v) => !v)} aria-label={t('voice.soundSettings')}>
                    <GearGlyph />
                  </button>
                </div>

                <div className={`fx-wave ${someoneSpeaking ? 'live' : ''}`} aria-hidden>
                  {Array.from({ length: 40 }).map((_, i) => (
                    <i key={i} style={{ animationDelay: `${i * 0.04}s` }} />
                  ))}
                </div>

                {audioBlocked && (
                  <button className="fx-unlock" onClick={unlockAudio}>{t('voice.audioUnlock')}</button>
                )}

                <div className="fx-vol">
                  <span className="fx-vol-ic"><VolGlyph muted={settings.volume === 0} /></span>
                  <input type="range" min="0" max="1" step="0.02" value={settings.volume}
                    onChange={(e) => settings.setVolume(parseFloat(e.target.value))} aria-label={t('set.volume')} />
                  <span className="fx-vol-val">{Math.round(settings.volume * 100)}%</span>
                </div>

                <div className="fx-controls">
                  {settings.pttMode ? (
                    <button
                      className={`fx-mic ${pttHeld ? 'live' : ''}`}
                      onMouseDown={() => { if (!micOn && !pttBusyRef.current) { pttBusyRef.current = true; setPttHeld(true); toggleMic().finally(() => { pttBusyRef.current = false }) } }}
                      onMouseUp={() => { if (micOn) { setPttHeld(false); toggleMic() } }}
                      onMouseLeave={() => { if (micOn) { setPttHeld(false); toggleMic() } }}
                      onTouchStart={(e) => { e.preventDefault(); if (!micOn && !pttBusyRef.current) { pttBusyRef.current = true; setPttHeld(true); toggleMic().finally(() => { pttBusyRef.current = false }) } }}
                      onTouchEnd={() => { if (micOn) { setPttHeld(false); toggleMic() } }}
                    >
                      <MicGlyph off={!pttHeld} />{pttHeld ? t('voice.pttLive') : t('voice.pttHold')}
                    </button>
                  ) : (
                    <button className={`fx-mic ${micOn ? 'live' : ''}`} onClick={toggleMic}>
                      <MicGlyph off={!micOn} />{micOn ? t('voice.muteMic') : t('voice.unmuteMic')}
                    </button>
                  )}
                  <button className="fx-leave" onClick={leave}>{t('voice.leave')}</button>
                </div>

                <div className="fx-parts" aria-label={t('voice.participants')}>
                  <span className={`fx-part me ${micOn ? 'mic' : ''} ${speaking && micOn ? 'speaking' : ''}`}>
                    <i style={{ background: user.color }} />{t('voice.you')}
                  </span>
                  {members.map((m) => (
                    <span key={m.user_id} className={`fx-part ${m.mic_on ? 'mic' : ''} ${m.speaking ? 'speaking' : ''}`}>
                      <i style={{ background: m.color }} />{m.nickname}
                    </span>
                  ))}
                </div>

                {error && <p className="fx-error">{error}</p>}
                {settingsOpen && <SettingsPanel settings={settings} onClose={() => setSettingsOpen(false)} />}
              </div>
            )}

            {/* ── YouTube Now Playing ── */}
            {(np?.video_id || joined) && (
              <div className="fx-np">
                {np?.video_id ? (
                  <>
                    <div className="fx-np-info">
                      <span className="fx-np-label">▶ {np.is_playing ? 'PLAYING' : 'PAUSED'}</span>
                      <span className="fx-np-title">{np.title || np.video_id}</span>
                      <button className="fx-np-stop" onClick={() => setNowPlaying(room, { video_id: '' }).then(setNp).catch(() => {})} title="Stop">✕</button>
                    </div>
                    <iframe
                      className="fx-yt"
                      src={`https://www.youtube.com/embed/${np.video_id}?autoplay=1&start=${Math.floor(np.position_sec)}&enablejsapi=1`}
                      allow="autoplay; encrypted-media"
                      allowFullScreen
                      title={np.title || 'YouTube'}
                    />
                  </>
                ) : (
                  <button className="fx-np-add" onClick={() => setNpOpen((v) => !v)}>
                    + YouTube
                  </button>
                )}
                {npOpen && (
                  <form className="fx-np-form" onSubmit={async (e) => {
                    e.preventDefault()
                    if (!npInput.trim()) return
                    const res = await setNowPlaying(room, { video_id: npInput.trim(), is_playing: true, position_sec: 0 }).catch(() => null)
                    if (res) { setNp(res); setNpOpen(false); setNpInput('') }
                  }}>
                    <input className="fx-np-input" value={npInput} onChange={(e) => setNpInput(e.target.value)} placeholder="YouTube URL or video ID" autoFocus />
                    <button type="submit">▶</button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Tile rail: schedule slots as NTS show-tiles ── */}
        <aside className="fx-rail" aria-label={t('nav.schedule')}>
          <a className="fx-rail-head" href="#schedule">
            <span>{t('schedule.kicker')}</span>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 4v15M6 13l6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </a>
          <div className="fx-tiles">
            {SLOT_STARTS.map((startH, i) => (
              <a key={startH} href="#schedule" className={`fx-tile s${i} ${i === activeSlot ? 'on' : ''}`}>
                <span className="fx-tile-top">
                  <span className="fx-tile-time">{pad2(startH)}:00</span>
                  {i === activeSlot
                    ? <span className="fx-tile-badge">On now</span>
                    : i === nextSlot
                      ? <span className="fx-tile-badge next">Next</span>
                      : null}
                </span>
                <span className="fx-tile-play" aria-hidden><PlayGlyph /></span>
                <span className="fx-tile-name">{t(`slot.${i}.label`)}</span>
              </a>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}
