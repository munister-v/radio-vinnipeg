import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ApiError,
  deleteMessage,
  fetchMessages,
  fetchOnline,
  pollMessages,
  renameMe,
  saveUser,
  sendMessage,
  type ChatMessage,
  type User,
} from './api'
import BroadcastPanel from './BroadcastPanel'

type Props = {
  user: User
  onUserChange: (u: User) => void
}

const POLL_INTERVAL_MS = 3000

function formatTime(iso: string): string {
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
}

export default function RadioPage({ user, onUserChange }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [online, setOnline] = useState<{ nickname: string; color: string }[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [editingNick, setEditingNick] = useState(false)
  const [nickDraft, setNickDraft] = useState(user.nickname)
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
        setOnline(await fetchOnline())
      } catch {
        // ignore transient errors — chat is best-effort
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
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
      // ignore
    }
  }

  async function handleRename(e: FormEvent) {
    e.preventDefault()
    const next = nickDraft.trim()
    if (!next || next === user.nickname) {
      setEditingNick(false)
      return
    }
    try {
      const updated = await renameMe(next)
      saveUser(updated)
      onUserChange(updated)
      setEditingNick(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося змінити нік.')
    }
  }

  return (
    <div className="radio-shell">
      <header className="chat-header">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-text">VINNIPEG NIGHTS</span>
        </div>
        <div className="header-right">
          <span className="online-count">{online.length} онлайн</span>
          {editingNick ? (
            <form className="nick-edit" onSubmit={handleRename}>
              <input
                value={nickDraft}
                onChange={(e) => setNickDraft(e.target.value)}
                maxLength={24}
                autoFocus
                onBlur={handleRename}
              />
            </form>
          ) : (
            <button
              className="nick-chip"
              onClick={() => {
                setNickDraft(user.nickname)
                setEditingNick(true)
              }}
              title="Змінити нік"
            >
              <span className="dot" style={{ background: user.color }} />
              <span style={{ color: user.color }}>{user.nickname}</span>
              <span className="nick-edit-icon">✎</span>
            </button>
          )}
        </div>
      </header>

      <div className="radio-body">
        <BroadcastPanel user={user} />

        <main className="chat-main">
          <div className="chat-col">
            <div className="messages">
              {messages.length === 0 && (
                <div className="messages-empty">Тиша в чаті. Напишіть перші 👋</div>
              )}
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

            {error && <div className="error banner">{error}</div>}

            <form className="composer" onSubmit={handleSend}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Напишіть як ${user.nickname}…`}
                maxLength={1000}
              />
              <button type="submit" disabled={sending || !draft.trim()}>
                Надіслати
              </button>
            </form>
          </div>

          <aside className="online-list">
            <h3>Слухачі онлайн</h3>
            <ul>
              {online.map((u, i) => (
                <li key={`${u.nickname}-${i}`}>
                  <span className="dot" style={{ background: u.color }} />
                  {u.nickname}
                </li>
              ))}
              {online.length === 0 && <li className="dim">Поки нікого немає</li>}
            </ul>
          </aside>
        </main>
      </div>
    </div>
  )
}
