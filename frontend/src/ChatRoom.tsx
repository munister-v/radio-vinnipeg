import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ApiError,
  clearSession,
  deleteMessage,
  fetchMessages,
  fetchOnline,
  logout,
  pollMessages,
  sendMessage,
  type ChatMessage,
  type User,
} from './api'
import CallBar from './CallBar'

type Props = {
  user: User
  onLeave: () => void
}

const POLL_INTERVAL_MS = 3000

function formatTime(iso: string): string {
  // SQLite returns "YYYY-MM-DD HH:MM:SS" (UTC, no offset) — normalize to ISO.
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatRoom({ user, onLeave }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [online, setOnline] = useState<{ nickname: string; color: string }[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const lastIdRef = useRef(0)
  const listEndRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const initial = await fetchMessages()
        if (cancelled) return
        setMessages(initial)
        if (initial.length) lastIdRef.current = initial[initial.length - 1].id
      } catch (err) {
        if (err instanceof ApiError) setError(err.message)
      }
    }

    init()

    pollRef.current = window.setInterval(async () => {
      try {
        const fresh = await pollMessages(lastIdRef.current)
        if (fresh.length) {
          setMessages((prev) => [...prev, ...fresh])
          lastIdRef.current = fresh[fresh.length - 1].id
        }
        const onlineList = await fetchOnline()
        setOnline(onlineList)
      } catch (err) {
        if (err instanceof ApiError && err.message.includes('авториз')) {
          clearSession()
          onLeave()
        }
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setError(null)
    try {
      const msg = await sendMessage(text)
      setMessages((prev) => [...prev, msg])
      lastIdRef.current = msg.id
      setDraft('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося надіслати повідомлення.')
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMessage(id)
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, text: 'Повідомлення видалено', is_deleted: true } : m)),
      )
    } catch {
      // ignore — best effort
    }
  }

  async function handleLeave() {
    try {
      await logout()
    } catch {
      // ignore
    }
    clearSession()
    onLeave()
  }

  return (
    <div className="chat-shell">
      <header className="chat-header">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-text">VINNIPEG NIGHTS</span>
        </div>
        <div className="header-right">
          <span className="online-count">{online.length} онлайн</span>
          <span className="me" style={{ color: user.color }}>{user.nickname}</span>
          <button className="link-btn" onClick={handleLeave}>Вийти</button>
        </div>
      </header>

      <CallBar user={user} />

      <main className="chat-main">
        <div className="messages">
          {messages.map((m) => (
            <div key={m.id} className={`message ${m.user_id === user.id ? 'mine' : ''}`}>
              <div className="message-meta">
                <span className="message-author" style={{ color: m.color }}>{m.nickname}</span>
                <span className="message-time">{formatTime(m.created_at)}</span>
              </div>
              <div className={`message-bubble ${m.is_deleted ? 'deleted' : ''}`}>
                {m.text}
                {!m.is_deleted && m.user_id === user.id && (
                  <button className="delete-btn" title="Видалити" onClick={() => handleDelete(m.id)}>
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
          <div ref={listEndRef} />
        </div>

        <aside className="online-list">
          <h3>Слухачі онлайн</h3>
          <ul>
            {online.map((u) => (
              <li key={u.nickname}>
                <span className="dot" style={{ background: u.color }} />
                {u.nickname}
              </li>
            ))}
            {online.length === 0 && <li className="dim">Поки нікого немає</li>}
          </ul>
        </aside>
      </main>

      {error && <div className="error banner">{error}</div>}

      <form className="composer" onSubmit={handleSend}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Напиши повідомлення…"
          maxLength={1000}
        />
        <button type="submit" disabled={sending || !draft.trim()}>
          Надіслати
        </button>
      </form>
    </div>
  )
}
