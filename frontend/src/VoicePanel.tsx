import { useEffect, useRef, useState } from 'react'
import type { User } from './api'
import SettingsPanel from './SettingsPanel'
import { useSettings } from './useSettings'
import { useVoice, type ConnectionQuality } from './useVoice'
import { useTranslation } from './useTranslation'
import { fetchTranslationHealth } from './api'
import { useI18n, peopleWord } from './i18n'

export type VoiceStats = { quality: ConnectionQuality; rttMs: number; lossPercent: number } | null

type Props = {
  user: User
  onStats?: (s: VoiceStats) => void
}

function Equalizer({ active }: { active: boolean }) {
  return (
    <div className={`eq ${active ? 'on' : ''}`} aria-hidden>
      {Array.from({ length: 7 }).map((_, i) => (
        <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </div>
  )
}

function SignalQuality({ quality }: { quality: 'good' | 'ok' | 'weak' | null }) {
  const { t } = useI18n()
  if (!quality) return null
  const label = quality === 'good' ? t('voice.qGood') : quality === 'ok' ? t('voice.qOk') : t('voice.qWeak')
  const bars = quality === 'good' ? 3 : quality === 'ok' ? 2 : 1
  return (
    <span className={`conn-quality q-${quality}`} title={label} aria-label={label}>
      <span className="conn-bars" aria-hidden>
        {[1, 2, 3].map((b) => <i key={b} className={b <= bars ? 'on' : ''} />)}
      </span>
    </span>
  )
}

function TranslateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 5.5h8M7 4v1.5M9.2 5.5c0 3.2-2.3 5.9-5.2 7M5.4 8.6c.9 2 2.6 3.5 4.8 4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m12.6 20 3.9-9.4L20.4 20M13.9 17.1h5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 4.5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0v-6Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {off && <path d="M3.5 3.5l17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5l12 6.5-12 6.5V5.5Z" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" />
    </svg>
  )
}

function VolumeIcon({ muted }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M11 5L6 9H3v6h3l5 4V5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      {!muted && <path d="M15.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
      {muted && <path d="M19 9l-6 6M13 9l6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
    </svg>
  )
}

function SignalDeck({ active, label }: { active: boolean; label: string }) {
  return (
    <div className={`signal-deck ${active ? 'is-active' : ''}`} aria-label={label}>
      <div className="signal-deck-meta">
        <span>SIGNAL / WEBRTC</span>
        <strong>{active ? 'LIVE' : 'STANDBY'}</strong>
      </div>
      <div className="signal-bars" aria-hidden>
        {Array.from({ length: 22 }).map((_, index) => (
          <i key={index} style={{ animationDelay: `${index * 0.045}s` }} />
        ))}
      </div>
      <div className="signal-scale" aria-hidden><span>−40</span><span>−20</span><span>−10</span><span>0 dB</span></div>
    </div>
  )
}

export default function VoicePanel({ user, onStats }: Props) {
  const { t, lang } = useI18n()
  const settings = useSettings()
  const { members, joined, micOn, connecting, error, speaking, quality, connStats, audioBlocked, unlockAudio, join, leave, toggleMic, getTranslationStream } =
    useVoice(user.id, { volume: settings.volume, micDeviceId: settings.micDeviceId })

  // Переклад ефіру: доступність питаємо один раз, вмикає слухач сам.
  const [trAvailable, setTrAvailable] = useState(false)
  const [trOn, setTrOn] = useState(false)
  useEffect(() => {
    let alive = true
    fetchTranslationHealth()
      .then((h) => { if (alive) setTrAvailable(!!h.enabled) })
      .catch(() => { if (alive) setTrAvailable(false) })
    return () => { alive = false }
  }, [])
  // Поки не в кімнаті, перекладати нічого.
  const translation = useTranslation(getTranslationStream, trOn && joined)
  useEffect(() => { if (!joined) setTrOn(false) }, [joined])

  const onStatsRef = useRef(onStats)
  useEffect(() => { onStatsRef.current = onStats })
  useEffect(() => {
    if (!joined || !quality) { onStatsRef.current?.(null); return }
    onStatsRef.current?.({ quality, rttMs: connStats.rttMs, lossPercent: connStats.lossPercent })
  }, [joined, quality, connStats.rttMs, connStats.lossPercent])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pttHeld, setPttHeld] = useState(false)
  const pttBusyRef = useRef(false)

  const speakers = members.filter((m) => m.speaking)
  const total = members.length + (joined ? 1 : 0)

  // J: join / leave voice
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyJ' || e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (connecting) return
      if (joined) leave()
      else join()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [joined, connecting, join, leave])

  // M: toggle mic (skip in PTT mode — Space is the PTT key)
  useEffect(() => {
    if (!joined || settings.pttMode) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyM' || e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      toggleMic()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [joined, settings.pttMode, toggleMic])

  // PTT: Space
  useEffect(() => {
    if (!joined || !settings.pttMode) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      if (!pttBusyRef.current && !micOn) {
        pttBusyRef.current = true
        setPttHeld(true)
        toggleMic().finally(() => { pttBusyRef.current = false })
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (pttHeld && micOn) { setPttHeld(false); toggleMic() }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [joined, settings.pttMode, micOn, pttHeld, toggleMic])

  const pttStart = () => {
    if (!micOn && !pttBusyRef.current) {
      pttBusyRef.current = true
      setPttHeld(true)
      toggleMic().finally(() => { pttBusyRef.current = false })
    }
  }
  const pttEnd = () => { if (micOn) { setPttHeld(false); toggleMic() } }

  // ── Joined: radio player ──────────────────────────────────────────────────
  if (joined) {
    const speakerNames = speakers.map((m) => m.nickname)
    if (micOn && speaking) speakerNames.push(t('voice.you'))

    const statusText = speakerNames.length > 0
      ? t('voice.speaking', { names: speakerNames.join(', ') })
      : micOn
        ? t('voice.micOn')
        : settings.pttMode
          ? t('voice.pttHint')
          : t('voice.listenHint')

    return (
      <section className="air air-live">
        {/* ── Status bar ── */}
        <div className="air-top">
          <span className="air-status live">
            {t('voice.inCallYou', { n: total, ppl: peopleWord(total, lang) })}
          </span>
          <div className="player-top-right">
            <SignalQuality quality={quality} />
            <Equalizer active={micOn || speakers.length > 0} />
            <button
              className="settings-gear"
              onClick={() => setSettingsOpen((v) => !v)}
              title={t('voice.settings')}
              aria-label={t('voice.soundSettings')}
              aria-expanded={settingsOpen}
            ><SettingsIcon /></button>
          </div>
        </div>

        {audioBlocked && (
          <button className="btn btn-primary audio-unlock" onClick={unlockAudio}>
            {t('voice.audioUnlock')}
          </button>
        )}
        {settingsOpen && <SettingsPanel settings={settings} onClose={() => setSettingsOpen(false)} />}

        {/* ── Volume row ── */}
        <div className="player-vol-row">
          <span className="player-vol-icon"><VolumeIcon muted={settings.volume === 0} /></span>
          <input
            className="player-vol-slider"
            type="range"
            min="0" max="1" step="0.02"
            value={settings.volume}
            onChange={(e) => settings.setVolume(parseFloat(e.target.value))}
            aria-label={t('set.volume')}
          />
          <span className="player-vol-val">{Math.round(settings.volume * 100)}%</span>
        </div>

        {/* ── Signal visualization ── */}
        <SignalDeck active={micOn || speakers.length > 0} label={t('voice.signalLabelLive')} />

        {/* ── What's playing ── */}
        <p className="player-now">{statusText}</p>

        {/* ── Controls ── */}
        <div className="player-controls">
          {settings.pttMode ? (
            <button
              className={`player-mic-btn ptt-btn ${pttHeld ? 'on' : ''}`}
              onMouseDown={pttStart}
              onMouseUp={pttEnd}
              onMouseLeave={pttEnd}
              onTouchStart={(e) => { e.preventDefault(); pttStart() }}
              onTouchEnd={pttEnd}
              aria-label={pttHeld ? t('voice.pttLive') : t('voice.pttHold')}
            >
              <span className="player-btn-icon"><MicIcon off={!pttHeld} /></span>
              <span className="player-btn-label">{pttHeld ? 'LIVE' : 'PTT'}</span>
            </button>
          ) : (
            <button
              className={`player-mic-btn ${micOn ? 'on' : ''}`}
              onClick={toggleMic}
              aria-label={micOn ? t('voice.muteMic') : t('voice.unmuteMic')}
            >
              <span className="player-btn-icon"><MicIcon off={!micOn} /></span>
              <span className="player-btn-label">{micOn ? 'MIC ON' : 'MIC OFF'}</span>
            </button>
          )}

          {trAvailable && (
            <button
              className={`player-tr-btn ${trOn ? 'on' : ''}`}
              onClick={() => setTrOn(v => !v)}
              aria-pressed={trOn}
              aria-label={trOn ? t('tr.toggleOn') : t('tr.toggleOff')}
            >
              <span className="player-btn-icon"><TranslateIcon /></span>
              <span className="player-btn-label">{trOn ? 'EN ON' : 'EN'}</span>
            </button>
          )}

          <button
            className="player-stop-btn"
            onClick={leave}
            aria-label={t('voice.leave')}
          >
            <span className="player-btn-icon"><StopIcon /></span>
            <span className="player-btn-label">STOP</span>
          </button>
        </div>

        {/* ── Переклад англійською ── */}
        {trOn && (
          <div className="air-translate" aria-live="polite">
            <div className="air-translate-top">
              <span className="air-translate-title">{t('tr.title')}</span>
              <span className={`air-translate-dot ${translation.busy ? 'on' : ''}`} aria-hidden />
              {translation.lines.length > 0 && (
                <button className="air-translate-clear" onClick={translation.clear}>{t('tr.clear')}</button>
              )}
            </div>
            {translation.error ? (
              <p className="air-translate-empty">{translation.error}</p>
            ) : translation.lines.length === 0 ? (
              <p className="air-translate-empty">{translation.busy ? t('tr.listening') : t('tr.waiting')}</p>
            ) : (
              <ol className="air-translate-lines">
                {translation.lines.map(l => <li key={l.id}>{l.text}</li>)}
              </ol>
            )}
            <p className="air-translate-hint">{t('tr.hint')}</p>
          </div>
        )}

        {/* ── Members ── */}
        <ul className="air-members" aria-label={t('voice.participants')}>
          <li className={`${micOn ? '' : 'muted-mic'} ${speaking ? 'speaking' : ''}`}>
            <span className="dot" style={{ background: user.color }} />
            {t('voice.you')} <small>{micOn ? 'MIC' : 'MUTE'}</small>
          </li>
          {members.map((m) => (
            <li key={m.user_id} className={`${m.mic_on ? '' : 'muted-mic'} ${m.speaking ? 'speaking' : ''}`}>
              <span className="dot" style={{ background: m.color }} />
              {m.nickname} <small>{m.mic_on ? 'MIC' : 'MUTE'}</small>
            </li>
          ))}
        </ul>

        {error && <div className="air-error">{error}</div>}
      </section>
    )
  }

  // ── On air, not joined ────────────────────────────────────────────────────
  if (members.length > 0) {
    return (
      <section className="air air-idle">
        <div className="air-top">
          <span className="air-status live">
            {t('voice.inCall', { n: members.length, ppl: peopleWord(members.length, lang) })}
          </span>
          <Equalizer active={members.some((m) => m.speaking)} />
        </div>

        <SignalDeck active={members.some((m) => m.speaking)} label={t('voice.signalLabelCurrent')} />

        <p className="player-now">{members.map((m) => m.nickname).join(' · ')}</p>

        <div className="player-play-wrap">
          <button
            className="player-play-btn"
            onClick={join}
            disabled={connecting}
            aria-label={connecting ? t('voice.connecting') : t('voice.join')}
          >
            <span className="player-play-icon"><PlayIcon /></span>
            <span className="player-play-label">
              {connecting ? t('voice.connecting') : 'TUNE IN'}
            </span>
          </button>
        </div>

        {error && <div className="air-error">{error}</div>}
      </section>
    )
  }

  // ── Silence ───────────────────────────────────────────────────────────────
  return (
    <section className="air air-idle">
      <div className="air-top">
        <span className="air-status">{t('voice.silence')}</span>
      </div>

      <SignalDeck active={false} label={t('voice.signalLabelWaiting')} />

      <p className="player-now">{t('voice.inviteCopy')}</p>

      <div className="player-play-wrap">
        <button
          className="player-play-btn player-play-btn--start"
          onClick={join}
          disabled={connecting}
          aria-label={connecting ? t('voice.connecting') : t('voice.start')}
        >
          <span className="player-play-icon"><PlayIcon /></span>
          <span className="player-play-label">
            {connecting ? t('voice.connecting') : 'START'}
          </span>
        </button>
      </div>

      {error && <div className="air-error">{error}</div>}
    </section>
  )
}
