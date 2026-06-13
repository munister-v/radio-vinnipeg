import type { User } from './api'
import { useCall } from './useCall'

type Props = {
  user: User
}

export default function CallBar({ user }: Props) {
  const { active, joined, members, muted, connecting, error, join, leave, toggleMute } = useCall(user.id)

  const count = joined ? members.length : active?.members.length ?? 0
  const isLive = count > 0

  return (
    <div className="call-bar">
      <div className="call-bar-info">
        <span className={`call-bar-icon ${isLive ? 'live' : ''}`}>🎙️</span>
        <span className="call-bar-title">Голосовий чат слухачів</span>
        {!joined && (
          <span>
            {isLive ? `Йде ефір · ${count} ${count === 1 ? 'учасник' : 'учасники'}` : 'Зараз нікого немає'}
          </span>
        )}
      </div>

      {joined && (
        <div className="call-bar-members">
          {members.map((m) => (
            <span key={m.user_id} className={`call-chip ${m.user_id === user.id ? 'me' : ''} ${m.user_id === user.id && muted ? 'muted' : ''}`}>
              <span className="dot" style={{ background: m.color }} />
              {m.nickname}
              {m.user_id === user.id && muted ? ' 🔇' : ''}
            </span>
          ))}
        </div>
      )}

      <div className="call-bar-actions">
        {!joined ? (
          <button className="call-btn join" onClick={join} disabled={connecting}>
            {connecting ? 'Підключення…' : isLive ? 'Приєднатись 🎙️' : 'Почати дзвінок 🎙️'}
          </button>
        ) : (
          <>
            <button className={`call-btn mute ${muted ? 'active' : ''}`} onClick={toggleMute}>
              {muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}
            </button>
            <button className="call-btn leave" onClick={leave}>Вийти з дзвінка</button>
          </>
        )}
      </div>

      {error && <div className="call-error">{error}</div>}
    </div>
  )
}
