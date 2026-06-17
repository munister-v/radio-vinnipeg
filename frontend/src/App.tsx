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
import { useI18n } from './i18n'

function App() {
  const { t } = useI18n()
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
        if (!cancelled) setError(t('app.connectError'))
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [t])

  if (error) {
    return <div className="loading">{error}</div>
  }
  if (!user) {
    return <div className="loading">{t('app.loading')}</div>
  }

  return <RadioPage user={user} onUserChange={setUser} />
}

export default App
