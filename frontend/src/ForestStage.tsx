import { useEffect, useRef, useState } from 'react'
import type { User } from './api'
import SettingsPanel from './SettingsPanel'
import { useSettings } from './useSettings'
import { useVoice } from './useVoice'
import type { VoiceStats } from './VoicePanel'
import { useI18n, peopleWord } from './i18n'
import './forest.css'

/* ────────────────────────────────────────────────────────────────────────
   Лісова сцена: іммерсивний хвойний горизонт + спокійний плеєр ефіру.
   Жодної брутальної сітки — глибина, туман, тепле світло, м'які форми.
   ──────────────────────────────────────────────────────────────────────── */

// Геральдична емблема (золото, лінійна) — повторюємо мотив знака курорту.
function Emblem({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none"
      stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="42" height="42" rx="6" strokeWidth="2" />
      <line x1="24" y1="4" x2="24" y2="44" strokeWidth="1.1" opacity=".4" />
      <line x1="4" y1="24" x2="44" y2="24" strokeWidth="1.1" opacity=".4" />
      <path d="M10.5 4 A6.5 6.5 0 0 1 4 10.5" strokeWidth="2" />
      <path d="M16 4 A12 12 0 0 1 4 16" strokeWidth="2" />
      <path d="M21.5 4 A17.5 17.5 0 0 1 4 21.5" strokeWidth="2" />
      <path d="M27 20 L34 13 L41 20" strokeWidth="2" />
      <path d="M27 14.5 L34 7.5 L41 14.5" strokeWidth="2" />
      <path d="M7 30 H21" strokeWidth="2" />
      <path d="M7 35 H21" strokeWidth="2" />
      <path d="M7 40 H21" strokeWidth="2" />
      <path d="M28 42 V34 a6 6 0 0 1 12 0 V42" strokeWidth="2" />
    </svg>
  )
}

// Згенерувати силует хвойного гребеня (полігони сосен) на всю ширину.
function pineRange(seed: number, count: number, minH: number, maxH: number): string {
  const W = 1440
  const base = 200
  const step = W / count
  let d = `M0 ${base} `
  for (let i = 0; i <= count; i++) {
    const cx = i * step
    const r = ((Math.sin(seed * 9.7 + i * 2.3) + 1) / 2)
    const h = minH + r * (maxH - minH)
    const half = step * 0.62
    d += `L${(cx - half).toFixed(1)} ${base} L${cx.toFixed(1)} ${(base - h).toFixed(1)} L${(cx + half).toFixed(1)} ${base} `
  }
  d += `L${W} ${base} L${W} ${base + 60} L0 ${base + 60} Z`
  return d
}

const RANGE_FAR = pineRange(1, 28, 38, 92)
const RANGE_MIDD = pineRange(4, 23, 55, 124)
const RANGE_MID = pineRange(7, 19, 78, 158)
const RANGE_NEAR = pineRange(13, 14, 116, 222)

// Вертикальні стволи переднього плану (краї щільніші, центр прозоріший).
const TRUNKS = [
  { x: 38, w: 56, op: .88 }, { x: 132, w: 30, op: .6 },
  { x: 1402, w: 54, op: .88 }, { x: 1300, w: 32, op: .62 },
  { x: 250, w: 18, op: .26 }, { x: 1170, w: 20, op: .3 },
  { x: 560, w: 12, op: .15 }, { x: 905, w: 15, op: .18 },
]
const trunkPts = (x: number, w: number) =>
  `${x - w * 0.42},0 ${x + w * 0.42},0 ${x + w * 0.5},1000 ${x - w * 0.5},1000`

// Порошинки/пилок у промені світла (детерміновано).
const MOTES = Array.from({ length: 16 }).map((_, i) => ({
  left: `${(i * 61) % 100}%`,
  s: `${2 + (i % 3) * 1.4}px`,
  d: `${15 + (i % 5) * 4}s`,
  delay: `${-(i * 1.7).toFixed(1)}s`,
}))

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

export default function ForestStage({ user, onStats }: { user: User; onStats?: (s: VoiceStats) => void }) {
  const { t, lang } = useI18n()
  const settings = useSettings()
  const { members, joined, micOn, connecting, error, speaking, quality, connStats, audioBlocked, unlockAudio, join, leave, toggleMic } =
    useVoice(user.id, { volume: settings.volume, micDeviceId: settings.micDeviceId })

  const onStatsRef = useRef(onStats)
  useEffect(() => { onStatsRef.current = onStats })
  useEffect(() => {
    if (!joined || !quality) { onStatsRef.current?.(null); return }
    onStatsRef.current?.({ quality, rttMs: connStats.rttMs, lossPercent: connStats.lossPercent })
  }, [joined, quality, connStats.rttMs, connStats.lossPercent])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pttHeld, setPttHeld] = useState(false)
  const pttBusyRef = useRef(false)
  const stageRef = useRef<HTMLElement>(null)

  // Легкий параллакс: шари рухаються з різною швидкістю при скролі героя.
  useEffect(() => {
    const root = stageRef.current
    if (!root) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const layers: Array<[HTMLElement | null, number]> = [
      [root.querySelector('.fx-sun'), 0.45],
      [root.querySelector('.fx-rays'), 0.42],
      [root.querySelector('.fx-forest'), 0.28],
      [root.querySelector('.fx-trunks'), 0.06],
    ]
    let ticking = false
    const apply = () => {
      ticking = false
      const y = window.scrollY
      if (y > window.innerHeight * 1.3) return
      for (const [el, k] of layers) {
        if (el) el.style.setProperty('--py', `${(y * k).toFixed(1)}px`)
      }
    }
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(apply) } }
    window.addEventListener('scroll', onScroll, { passive: true })
    apply()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const total = members.length + (joined ? 1 : 0)
  const speakers = members.filter((m) => m.speaking)
  const someoneSpeaking = speakers.length > 0 || (joined && micOn && speaking)
  const active = joined || members.length > 0

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

  const statusLabel = joined
    ? (someoneSpeaking ? t('voice.micOn') : settings.pttMode ? t('voice.pttHint') : t('voice.listenHint'))
    : members.length > 0
      ? t('voice.inProgress')
      : t('voice.nobody')

  return (
    <section className="fx-stage" id="air" ref={stageRef}>
      {/* ── Атмосфера ── */}
      <div className="fx-sky" aria-hidden />
      <div className="fx-rays" aria-hidden />
      <div className="fx-sun" aria-hidden />
      <svg className="fx-forest" viewBox="0 0 1440 260" preserveAspectRatio="xMidYMax slice" aria-hidden>
        <path className="fx-layer fx-far" d={RANGE_FAR} />
        <path className="fx-layer fx-midd" d={RANGE_MIDD} />
        <path className="fx-layer fx-mid" d={RANGE_MID} />
        <path className="fx-layer fx-near" d={RANGE_NEAR} />
      </svg>
      <svg className="fx-trunks" viewBox="0 0 1440 1000" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="fx-trunk-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#33271a" />
            <stop offset="0.55" stopColor="#22301a" />
            <stop offset="1" stopColor="#14210e" />
          </linearGradient>
        </defs>
        {TRUNKS.map((tr, i) => (
          <polygon key={i} points={trunkPts(tr.x, tr.w)} opacity={tr.op} />
        ))}
      </svg>
      <div className="fx-mist" aria-hidden />
      <div className="fx-motes" aria-hidden>
        {MOTES.map((m, i) => (
          <i key={i} style={{ left: m.left, width: m.s, height: m.s, animationDuration: m.d, animationDelay: m.delay }} />
        ))}
      </div>
      <div className="fx-grain" aria-hidden />

      {/* ── Контент ── */}
      <div className="fx-content">
        <Emblem className="fx-emblem" />
        <p className="fx-eyebrow">{t('hero.kicker')}</p>
        <h1 className="fx-wordmark">Radio Vinnipeg</h1>
        <p className="fx-tagline">{t('hero.tagline')}</p>

        {/* ── Плеєр ефіру ── */}
        <div className={`fx-player ${active ? 'is-active' : ''}`}>
          <div className="fx-player-head">
            <span className={`fx-pulse ${active ? 'on' : ''}`} aria-hidden />
            <span className="fx-player-status">
              {active
                ? t('voice.inCallYou', { n: total || members.length, ppl: peopleWord(total || members.length, lang) })
                : t('voice.silence')}
            </span>
            {joined && (
              <button className="fx-gear" onClick={() => setSettingsOpen((v) => !v)} aria-label={t('voice.soundSettings')}>
                <GearGlyph />
              </button>
            )}
          </div>

          <p className="fx-player-now">{statusLabel}</p>

          {/* Велике коло «вийти в ефір» / стан */}
          {!joined ? (
            <div className="fx-tune-wrap">
              <button className="fx-tune" onClick={join} disabled={connecting} aria-label={members.length ? t('voice.join') : t('voice.start')}>
                <span className={`fx-ring r1 ${active ? 'on' : ''}`} aria-hidden />
                <span className={`fx-ring r2 ${active ? 'on' : ''}`} aria-hidden />
                <span className={`fx-ring r3 ${active ? 'on' : ''}`} aria-hidden />
                <span className="fx-tune-core"><PlayGlyph /></span>
              </button>
              <span className="fx-tune-label">
                {connecting ? t('voice.connecting') : members.length ? t('voice.join') : t('voice.start')}
              </span>
            </div>
          ) : (
            <>
              {/* Хвиля ефіру */}
              <div className={`fx-wave ${someoneSpeaking ? 'live' : ''}`} aria-hidden>
                {Array.from({ length: 28 }).map((_, i) => (
                  <i key={i} style={{ animationDelay: `${i * 0.05}s` }} />
                ))}
              </div>

              {audioBlocked && (
                <button className="fx-unlock" onClick={unlockAudio}>{t('voice.audioUnlock')}</button>
              )}

              {/* Гучність */}
              <div className="fx-vol">
                <span className="fx-vol-ic"><VolGlyph muted={settings.volume === 0} /></span>
                <input type="range" min="0" max="1" step="0.02" value={settings.volume}
                  onChange={(e) => settings.setVolume(parseFloat(e.target.value))} aria-label={t('set.volume')} />
                <span className="fx-vol-val">{Math.round(settings.volume * 100)}%</span>
              </div>

              {/* Керування */}
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
            </>
          )}

          {/* Учасники */}
          {(members.length > 0 || joined) && (
            <div className="fx-parts" aria-label={t('voice.participants')}>
              {joined && (
                <span className={`fx-part me ${micOn ? 'mic' : ''} ${speaking && micOn ? 'speaking' : ''}`}>
                  <i style={{ background: user.color }} />{t('voice.you')}
                </span>
              )}
              {members.map((m) => (
                <span key={m.user_id} className={`fx-part ${m.mic_on ? 'mic' : ''} ${m.speaking ? 'speaking' : ''}`}>
                  <i style={{ background: m.color }} />{m.nickname}
                </span>
              ))}
            </div>
          )}

          {error && <p className="fx-error">{error}</p>}
          {settingsOpen && <SettingsPanel settings={settings} onClose={() => setSettingsOpen(false)} />}
        </div>
      </div>

      <a className="fx-scroll" href="#schedule" aria-label={t('nav.schedule')}>
        <span>{t('nav.schedule')}</span>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 4v15M6 13l6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </a>
    </section>
  )
}
