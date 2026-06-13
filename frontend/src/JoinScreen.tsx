import { useState, type FormEvent } from 'react'
import { ApiError, joinChat, saveSession, type User } from './api'

type Props = {
  onJoined: (user: User) => void
}

export default function JoinScreen({ onJoined }: Props) {
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { token, user } = await joinChat(nickname.trim(), password)
      saveSession(token, user)
      onJoined(user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося підключитися. Спробуйте ще раз.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="join-screen">
      <div className="join-card">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-text">VINNIPEG NIGHTS</span>
        </div>
        <h1>Чат для слухачів</h1>
        <p className="subtitle">
          Заходь під своїм ніком та спілкуйся з іншими слухачами в ефірі.
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            Нік
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Напр. NightOwl"
              maxLength={24}
              required
              autoFocus
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Мінімум 4 символи"
              minLength={4}
              required
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={busy}>
            {busy ? 'Підключення…' : 'Увійти в ефір'}
          </button>
        </form>

        <p className="hint">
          Нік ще не зайнятий? Він буде закріплений за цим паролем —
          щоб повернутись пізніше, використай той самий нік і пароль.
        </p>
      </div>
    </div>
  )
}
