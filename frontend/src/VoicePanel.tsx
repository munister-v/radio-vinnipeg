import { useEffect, useRef, useState } from 'react'
import type { User } from './api'
import SettingsPanel from './SettingsPanel'
import { useSettings } from './useSettings'
import { useVoice } from './useVoice'

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

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

export default function VoicePanel({ user }: Props) {
  const settings = useSettings()
  const { members, joined, micOn, connecting, error, speaking, join, leave, toggleMic } =
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
    if (micOn && speaking) speakerNames.push('ви')
    return (
      <section className="air air-live">
        <div className="air-top">
          <span className="air-status live">Ви в розмові · {total} {plural(total)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Equalizer active={micOn || speakers.length > 0} />
            <button
              className="settings-gear"
              onClick={() => setSettingsOpen((v) => !v)}
              title="Налаштування"
              aria-label="Налаштування звуку"
              aria-expanded={settingsOpen}
            ><SettingsIcon /></button>
          </div>
        </div>

        {settingsOpen && (
          <SettingsPanel settings={settings} onClose={() => setSettingsOpen(false)} />
        )}

        <h2 className="air-title">Радіорозмова наживо</h2>
        <p className="air-sub">
          {speakerNames.length > 0
            ? `Говорить: ${speakerNames.join(', ')}`
            : micOn
              ? 'Мікрофон увімкнено — говоріть, вас чують'
              : settings.pttMode
                ? 'Тримайте Space або кнопку нижче щоб говорити'
                : 'Слухаєте. Натисніть мікрофон, щоб сказати слово'}
        </p>
        <div className="air-actions">
          {settings.pttMode ? (
            <button
              className={`btn btn-ghost ptt-btn ${pttHeld ? 'active' : ''}`}
              onMouseDown={pttStart}
              onMouseUp={pttEnd}
              onMouseLeave={pttEnd}
              onTouchStart={(e) => { e.preventDefault(); pttStart() }}
              onTouchEnd={pttEnd}
            >
              {pttHeld ? 'Говорите наживо…' : 'Тримайте PTT'}
            </button>
          ) : (
            <button className={`btn btn-ghost ${micOn ? 'active' : ''}`} onClick={toggleMic}>
              {micOn ? 'Вимкнути мікрофон' : 'Увімкнути мікрофон'}
            </button>
          )}
          <button className="btn btn-outline" onClick={leave}>Вийти з розмови</button>
        </div>
        <ul className="air-members" aria-label="Учасники розмови">
          <li className={`${micOn ? '' : 'muted-mic'} ${speaking ? 'speaking' : ''}`}>
            <span className="dot" style={{ background: user.color }} />
            ви <small>{micOn ? 'MIC' : 'MUTE'}</small>
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
          <span className="air-status live">У розмові · {members.length} {plural(members.length)}</span>
          <Equalizer active={members.some((m) => m.speaking)} />
        </div>
        <h2 className="air-title">Розмова триває</h2>
        <p className="air-sub">{members.map((m) => m.nickname).join(', ')}</p>
        <div className="air-actions">
          <button className="btn btn-primary" onClick={join} disabled={connecting}>
            {connecting ? 'Підключення…' : 'Приєднатися до ефіру'}
          </button>
        </div>
        <ul className="air-members" aria-label="Учасники розмови">
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
        <span className="air-status">Тиша в ефірі</span>
      </div>
      <h2 className="air-title">Зараз тут нікого немає</h2>
      <p className="air-sub">
        Приєднайтесь до групової розмови — слухати можна без мікрофона, говорити лише за бажанням.
      </p>
      <div className="air-actions">
        <button className="btn btn-primary" onClick={join} disabled={connecting}>
          {connecting ? 'Підключення…' : 'Розпочати живий ефір'}
        </button>
      </div>
      {error && <div className="air-error">{error}</div>}
    </section>
  )
}

function plural(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'людина'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'людини'
  return 'людей'
}
