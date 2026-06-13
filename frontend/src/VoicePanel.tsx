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
  const { members, joined, micOn, connecting, error, join, leave, toggleMic } = useVoice(user.id)

  const speakers = members.filter((m) => m.mic_on)
  const total = members.length + (joined ? 1 : 0)

  if (joined) {
    return (
      <section className="air air-call">
        <div className="air-main">
          <div className="air-badge live">
            Ви в розмові · {total} {plural(total)}
          </div>
          <h2 className="air-title">Канадська ніч</h2>
          <p className="air-sub">
            {speakers.length > 0
              ? `говорить: ${speakers.map((m) => m.nickname).join(', ')}${micOn ? ', ви' : ''}`
              : micOn ? 'ви говорите' : 'натисніть мікрофон, щоб сказати слово'}
          </p>
        </div>
        <Equalizer active={micOn || speakers.length > 0} />
        <div className="air-actions">
          <button className={`air-btn ghost ${micOn ? 'active' : ''}`} onClick={toggleMic}>
            {micOn ? '🎙️ Вимкнути мікрофон' : '🎙️ Увімкнути мікрофон'}
          </button>
          <button className="air-btn stop" onClick={leave}>Вийти з розмови</button>
        </div>
        {members.length > 0 && (
          <ul className="air-members" aria-label="Учасники розмови">
            {members.map((m) => (
              <li key={m.user_id} className={m.mic_on ? 'speaking' : ''}>
                <span className="dot" style={{ background: m.color }} />
                {m.nickname}
              </li>
            ))}
          </ul>
        )}
        {error && <div className="air-error">{error}</div>}
      </section>
    )
  }

  if (members.length > 0) {
    return (
      <section className="air air-onair">
        <div className="air-main">
          <div className="air-badge live">
            У розмові · {members.length} {plural(members.length)}
          </div>
          <h2 className="air-title">Розмова триває</h2>
          <p className="air-sub">{members.map((m) => m.nickname).join(', ')}</p>
        </div>
        <Equalizer active={members.some((m) => m.mic_on)} />
        <div className="air-actions">
          <button className="air-btn play" onClick={join} disabled={connecting}>
            {connecting ? 'Підключення…' : '▶ Приєднатися'}
          </button>
        </div>
        {error && <div className="air-error">{error}</div>}
      </section>
    )
  }

  return (
    <section className="air air-silent">
      <div className="air-main">
        <div className="air-badge">Тиша в ефірі</div>
        <h2 className="air-title">Зараз тут нікого немає</h2>
        <p className="air-sub">приєднайтесь до розмови — слухати можна без мікрофона, говорити лише за бажанням</p>
      </div>
      <div className="air-actions">
        <button className="air-btn play" onClick={join} disabled={connecting}>
          {connecting ? 'Підключення…' : '🎙️ Приєднатися'}
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
