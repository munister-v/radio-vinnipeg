import type { User } from './api'
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

export default function VoicePanel({ user }: Props) {
  const { members, joined, micOn, connecting, error, speaking, join, leave, toggleMic } =
    useVoice(user.id)

  const speakers = members.filter((m) => m.speaking)
  const total = members.length + (joined ? 1 : 0)

  // ── Ви в розмові ──────────────────────────────────────────────────────────
  if (joined) {
    const speakerNames = speakers.map((m) => m.nickname)
    if (micOn && speaking) speakerNames.push('ви')
    return (
      <section className="air air-live">
        <div className="air-top">
          <span className="air-status live">Ви в розмові · {total} {plural(total)}</span>
          <Equalizer active={micOn || speakers.length > 0} />
        </div>
        <h2 className="air-title">Радіорозмова наживо</h2>
        <p className="air-sub">
          {speakerNames.length > 0
            ? `Говорить: ${speakerNames.join(', ')}`
            : micOn
              ? 'Мікрофон увімкнено — говоріть, вас чують'
              : 'Слухаєте. Натисніть мікрофон, щоб сказати слово'}
        </p>
        <div className="air-actions">
          <button className={`btn btn-ghost ${micOn ? 'active' : ''}`} onClick={toggleMic}>
            {micOn ? '🎙 Вимкнути мікрофон' : '🎙 Увімкнути мікрофон'}
          </button>
          <button className="btn btn-outline" onClick={leave}>Вийти з розмови</button>
        </div>
        <ul className="air-members" aria-label="Учасники розмови">
          <li className={`${micOn ? '' : 'muted-mic'} ${speaking ? 'speaking' : ''}`}>
            <span className="dot" style={{ background: user.color }} />
            ви {micOn ? '🎙' : '🔇'}
          </li>
          {members.map((m) => (
            <li
              key={m.user_id}
              className={`${m.mic_on ? '' : 'muted-mic'} ${m.speaking ? 'speaking' : ''}`}
            >
              <span className="dot" style={{ background: m.color }} />
              {m.nickname} {m.mic_on ? '🎙' : '🔇'}
            </li>
          ))}
        </ul>
        {error && <div className="air-error">{error}</div>}
      </section>
    )
  }

  // ── Розмова триває (ще не приєднались) ───────────────────────────────────
  if (members.length > 0) {
    return (
      <section className="air air-idle">
        <div className="air-top">
          <span className="air-status live">
            У розмові · {members.length} {plural(members.length)}
          </span>
          <Equalizer active={members.some((m) => m.speaking)} />
        </div>
        <h2 className="air-title">Розмова триває</h2>
        <p className="air-sub">{members.map((m) => m.nickname).join(', ')}</p>
        <div className="air-actions">
          <button className="btn btn-primary" onClick={join} disabled={connecting}>
            {connecting ? 'Підключення…' : '▶ Приєднатися'}
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
          {connecting ? 'Підключення…' : '🎙 Розпочати розмову'}
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
