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
import VoicePanel from './VoicePanel'

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
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
                <path d="M7.5 7.5a6 6 0 0 0 0 9" />
                <path d="M16.5 7.5a6 6 0 0 1 0 9" />
                <path d="M4.7 4.7a10 10 0 0 0 0 14.6" />
                <path d="M19.3 4.7a10 10 0 0 1 0 14.6" />
              </svg>
            </span>
            <div className="brand-titles">
              <span className="brand-eyebrow">Живий ефір</span>
              <span className="brand-name">Radio Vinnipeg</span>
            </div>
          </div>
          <div className="topbar-right">
            <span className="online-pill"><span className="dot-live" />{online.length} онлайн</span>
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
                <span>{user.nickname}</span>
                <span className="nick-edit-icon">✎</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <span className="hero-badge">Живий ефір</span>
          <h1 className="hero-title">Radio<br />Vinnipeg</h1>
          <p className="hero-lead">Відкрите живе радіо з груповими розмовами та чатом — без реєстрації, прямо в браузері</p>
        </div>
      </section>

      <main className="page">
        <VoicePanel user={user} />

        <section className="chat-area">
          <div className="chat-card">
            <div className="messages">
              {messages.length === 0 && (
                <div className="messages-empty">Тиша в чаті. Напишіть перші 👋</div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`message ${m.user_id === user.id ? 'mine' : ''}`}>
                  <div className="message-meta">
                    <span className="message-author" style={{ color: m.user_id === user.id ? undefined : m.color }}>{m.nickname}</span>
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

          <aside className="online-card">
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
        </section>
      </main>
    </div>
  )
}
