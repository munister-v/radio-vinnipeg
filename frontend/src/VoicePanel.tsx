import { useEffect, useRef, useState } from 'react'
import type { User } from './api'
import SettingsPanel from './SettingsPanel'
import { useSettings } from './useSettings'
import { useVoice } from './useVoice'
import { useI18n, peopleWord } from './i18n'

type Props = { user: User }

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
      <span className="conn-label">{label}</span>
    </span>
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

export default function VoicePanel({ user }: Props) {
  const { t, lang } = useI18n()
  const settings = useSettings()
  const { members, joined, micOn, connecting, error, speaking, quality, audioBlocked, unlockAudio, join, leave, toggleMic } =
    useVoice(user.id, { volume: settings.volume, micDeviceId: settings.micDeviceId })

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pttHeld, setPttHeld] = useState(false)
  const pttBusyRef = useRef(false)

  const speakers = members.filter((m) => m.speaking)
  const total = members.length + (joined ? 1 : 0)

  // ── PTT: Space (клавіатура) ───────────────────────────────────────────────
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
      if (pttHeld && micOn) {
        setPttHeld(false)
        toggleMic()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [joined, settings.pttMode, micOn, pttHeld, toggleMic])

  // PTT: тримати кнопку
  const pttStart = () => {
    if (!micOn && !pttBusyRef.current) {
      pttBusyRef.current = true
      setPttHeld(true)
      toggleMic().finally(() => { pttBusyRef.current = false })
    }
  }
  const pttEnd = () => {
    if (micOn) { setPttHeld(false); toggleMic() }
  }

  // ── Ви в розмові ─────────────────────────────────────────────────────────
  if (joined) {
    const speakerNames = speakers.map((m) => m.nickname)
    if (micOn && speaking) speakerNames.push(t('voice.you'))
    return (
      <section className="air air-live">
        <div className="air-top">
          <span className="air-status live">{t('voice.inCallYou', { n: total, ppl: peopleWord(total, lang) })}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
        <SignalDeck active={micOn || speakers.length > 0} label={t('voice.signalLabelLive')} />

        {audioBlocked && (
          <button className="btn btn-primary audio-unlock" onClick={unlockAudio}>
            {t('voice.audioUnlock')}
          </button>
        )}

        {settingsOpen && (
          <SettingsPanel settings={settings} onClose={() => setSettingsOpen(false)} />
        )}

        <h2 className="air-title">{t('voice.liveTitle')}</h2>
        <p className="air-sub">
          {speakerNames.length > 0
            ? t('voice.speaking', { names: speakerNames.join(', ') })
            : micOn
              ? t('voice.micOn')
              : settings.pttMode
                ? t('voice.pttHint')
                : t('voice.listenHint')}
        </p>
        <div className="air-actions">
          {settings.pttMode ? (
            <button
              className={`btn btn-mic ptt-btn ${pttHeld ? 'on' : ''}`}
              onMouseDown={pttStart}
              onMouseUp={pttEnd}
              onMouseLeave={pttEnd}
              onTouchStart={(e) => { e.preventDefault(); pttStart() }}
              onTouchEnd={pttEnd}
            >
              <span className="btn-mic-icon"><MicIcon off={!pttHeld} /></span>
              {pttHeld ? t('voice.pttLive') : t('voice.pttHold')}
            </button>
          ) : (
            <button className={`btn btn-mic ${micOn ? 'on' : ''}`} onClick={toggleMic}>
              <span className="btn-mic-icon"><MicIcon off={!micOn} /></span>
              {micOn ? t('voice.muteMic') : t('voice.unmuteMic')}
            </button>
          )}
          <button className="btn btn-outline" onClick={leave}>{t('voice.leave')}</button>
        </div>
        <ul className="air-members" aria-label={t('voice.participants')}>
          <li className={`${micOn ? '' : 'muted-mic'} ${speaking ? 'speaking' : ''}`}>
            <span className="dot" style={{ background: user.color }} />
            {t('voice.you')} <small>{micOn ? 'MIC' : 'MUTE'}</small>
          </li>
          {members.map((m) => (
            <li
              key={m.user_id}
              className={`${m.mic_on ? '' : 'muted-mic'} ${m.speaking ? 'speaking' : ''}`}
            >
              <span className="dot" style={{ background: m.color }} />
              {m.nickname} <small>{m.mic_on ? 'MIC' : 'MUTE'}</small>
            </li>
          ))}
        </ul>
        {error && <div className="air-error">{error}</div>}
      </section>
    )
  }

  // ── Розмова триває ────────────────────────────────────────────────────────
  if (members.length > 0) {
    return (
      <section className="air air-idle">
        <div className="air-top">
          <span className="air-status live">{t('voice.inCall', { n: members.length, ppl: peopleWord(members.length, lang) })}</span>
          <Equalizer active={members.some((m) => m.speaking)} />
        </div>
        <SignalDeck active={members.some((m) => m.speaking)} label={t('voice.signalLabelCurrent')} />
        <h2 className="air-title">{t('voice.inProgress')}</h2>
        <p className="air-sub">{members.map((m) => m.nickname).join(', ')}</p>
        <div className="air-actions">
          <button className="btn btn-primary" onClick={join} disabled={connecting}>
            {connecting ? t('voice.connecting') : t('voice.join')}
          </button>
        </div>
        <ul className="air-members" aria-label={t('voice.participants')}>
          {members.map((m) => (
            <li key={m.user_id} className={m.speaking ? 'speaking' : ''}>
              <span className="dot" style={{ background: m.color }} />
              {m.nickname}
            </li>
          ))}
        </ul>
        {error && <div className="air-error">{error}</div>}
      </section>
    )
  }

  // ── Тиша ─────────────────────────────────────────────────────────────────
  return (
    <section className="air air-idle">
      <div className="air-top">
        <span className="air-status">{t('voice.silence')}</span>
      </div>
      <SignalDeck active={false} label={t('voice.signalLabelWaiting')} />
      <h2 className="air-title">{t('voice.nobody')}</h2>
      <p className="air-sub">
        {t('voice.inviteCopy')}
      </p>
      <div className="air-actions">
        <button className="btn btn-primary" onClick={join} disabled={connecting}>
          {connecting ? t('voice.connecting') : t('voice.start')}
        </button>
      </div>
      {error && <div className="air-error">{error}</div>}
    </section>
  )
}
