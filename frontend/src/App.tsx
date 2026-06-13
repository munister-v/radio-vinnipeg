import { useEffect, useState } from 'react'
import './App.css'
import RadioPage from './RadioPage'
import {
  clearSession,
  fetchMe,
  getStoredUser,
  getToken,
  guestJoin,
  saveSession,
  type User,
} from './api'

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      const token = getToken()
      const stored = getStoredUser()
      // Уже є сесія — підтверджуємо її.
      if (token && stored) {
        try {
          const me = await fetchMe()
          if (!cancelled) setUser(me)
          return
        } catch {
          clearSession()
        }
      }
      // Радіо повністю відкрите: тихо створюємо гостьовий профіль.
      try {
        const { token: t, user: u } = await guestJoin()
        saveSession(t, u)
        if (!cancelled) setUser(u)
      } catch {
        if (!cancelled) setError('Не вдалося підключитися до радіо. Оновіть сторінку.')
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <div className="loading">{error}</div>
  }
  if (!user) {
    return <div className="loading">Налаштовуємо ефір…</div>
  }

  return <RadioPage user={user} onUserChange={setUser} />
}

export default App
