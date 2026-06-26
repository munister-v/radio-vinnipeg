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
    <section className="fx-stage" id="air">
      {/* Soft Apple aurora glow behind the wordmark */}
      <div className="fx-aurora" aria-hidden>
        <span className="fx-aurora-a" />
        <span className="fx-aurora-b" />
        <span className="fx-aurora-c" />
      </div>

      <div className="fx-content">
        <p className="fx-eyebrow">
          <span className={`fx-eyebrow-dot ${active ? 'on' : ''}`} aria-hidden />
          Winnipeg · Manitoba · 94.7 FM
        </p>
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
