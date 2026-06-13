import { useEffect, useState } from 'react'
import './App.css'
import JoinScreen from './JoinScreen'
import ChatRoom from './ChatRoom'
import { clearSession, fetchMe, getStoredUser, getToken, type User } from './api'

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const token = getToken()
    const stored = getStoredUser()
    if (!token || !stored) {
      setChecking(false)
      return
    }
    fetchMe()
      .then((me) => setUser(me))
      .catch(() => clearSession())
      .finally(() => setChecking(false))
  }, [])

  if (checking) {
    return <div className="loading">Завантаження…</div>
  }

  if (!user) {
    return <JoinScreen onJoined={setUser} />
  }

  return <ChatRoom user={user} onLeave={() => setUser(null)} />
}

export default App
