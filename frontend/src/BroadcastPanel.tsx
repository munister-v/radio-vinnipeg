import { useState } from 'react'
import type { User } from './api'
import { useBroadcast } from './useBroadcast'

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

export default function BroadcastPanel({ user }: Props) {
  const { live, role, connecting, muted, error, start, stop, listen, stopListening, toggleMute } =
    useBroadcast(user.id)
  const [title, setTitle] = useState('')

  const isHost = role === 'host'
  const isListener = role === 'listener'
  const someoneLive = !!live

  // 1) Я веду ефір
  if (isHost) {
    return (
      <section className="air air-host">
        <div className="air-main">
          <div className="air-badge live">
            Ви в ефірі · {live?.listener_count ?? 0} {plural(live?.listener_count ?? 0)}
          </div>
          <h2 className="air-title">{live?.title || 'Ваш ефір'}</h2>
          <p className="air-sub">наживо як {user.nickname}</p>
        </div>
        <Equalizer active={!muted} />
        <div className="air-actions">
          <button className={`air-btn ghost ${muted ? 'active' : ''}`} onClick={toggleMute}>
            {muted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон'}
          </button>
          <button className="air-btn stop" onClick={stop}>Завершити ефір</button>
        </div>
        {error && <div className="air-error">{error}</div>}
      </section>
    )
  }

  // 2) Хтось веде ефір (я слухач або ще ні)
  if (someoneLive && live) {
    return (
      <section className="air air-onair">
        <div className="air-main">
          <div className="air-badge live">
            Зараз в ефірі · {live.listener_count} {plural(live.listener_count)}
          </div>
          <h2 className="air-title">{live.title || 'Нічний ефір'}</h2>
          <p className="air-sub">веде {live.host_nickname}</p>
        </div>
        <Equalizer active={isListener} />
        <div className="air-actions">
          {isListener ? (
            <button className="air-btn stop" onClick={stopListening}>Зупинити</button>
          ) : (
            <button className="air-btn play" onClick={() => listen(live.broadcast_id)} disabled={connecting}>
              {connecting ? 'Підключення…' : '▶ Слухати'}
            </button>
          )}
        </div>
        {error && <div className="air-error">{error}</div>}
      </section>
    )
  }

  // 3) Тиша — можна почати свій ефір
  return (
    <section className="air air-silent">
      <div className="air-main">
        <div className="air-badge">Тиша в ефірі</div>
        <h2 className="air-title">Зараз ніхто не вещає</h2>
        <p className="air-sub">запустіть свій ефір — слухачі почують вас наживо, мікрофон їм не потрібен</p>
      </div>
      <div className="air-start">
        <input
          className="air-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Назва ефіру (необов'язково)"
          maxLength={120}
        />
        <button className="air-btn play" onClick={() => start(title)} disabled={connecting}>
          {connecting ? 'Підключення…' : '🎙️ Вийти в ефір'}
        </button>
      </div>
      {error && <div className="air-error">{error}</div>}
    </section>
  )
}

function plural(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'слухач'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'слухачі'
  return 'слухачів'
}
