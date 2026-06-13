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
  const [chatOpen, setChatOpen] = useState(false)
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
    if (chatOpen) listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatOpen])

  useEffect(() => {
    if (!chatOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChatOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [chatOpen])

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
          <a className="brand" href="#air" aria-label="Radio Vinnipeg — до ефіру">
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
              <span className="brand-eyebrow">Munister / Radio 01</span>
              <span className="brand-name">Radio Vinnipeg</span>
            </div>
          </a>
          <nav className="topbar-nav" aria-label="Головна навігація">
            <a href="#air">Ефір</a>
            <a href="#about">Про радіо</a>
            <button type="button" onClick={() => setChatOpen(true)}>Чат</button>
          </nav>
          <div className="topbar-right">
            <span className="online-pill"><span className="dot-live" />Ефір відкрито · {online.length}</span>
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
                <span className="nick-edit-icon" aria-hidden>↗</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="broadcast-stage" id="air">
          <div className="broadcast-intro">
            <div className="section-kicker"><span>01</span> Незалежний живий ефір</div>
            <h1>Radio<br />Vinnipeg</h1>
            <p>
              Відкрите радіо, де слухач може стати голосом ефіру.
              Без реєстрації. Просто в браузері.
            </p>
          </div>
          <div className="frequency" aria-label="Частота Radio Vinnipeg">
            <span>ON AIR</span>
            <strong>24/7</strong>
            <small>WEB FREQUENCY</small>
          </div>
          <div className="broadcast-console">
            <VoicePanel user={user} />
          </div>
        </section>

        <div className="radio-ticker" aria-hidden>
          <span>LIVE CONVERSATION</span>
          <i />
          <span>OPEN MICROPHONE</span>
          <i />
          <span>WINNIPEG / ONLINE</span>
          <i />
          <span>NO REGISTRATION</span>
        </div>

        <section className="radio-manifesto" id="about">
          <div className="section-kicker"><span>02</span> Радіо як спільний простір</div>
          <h2>Не плейлист.<br />Живі люди.</h2>
          <div className="manifesto-copy">
            <p>Слухайте розмову наживо або долучайтеся з мікрофоном, коли маєте що сказати.</p>
            <dl>
              <div><dt>Вхід</dt><dd>без реєстрації</dd></div>
              <div><dt>Формат</dt><dd>відкритий мікрофон</dd></div>
              <div><dt>Зв'язок</dt><dd>наживо у браузері</dd></div>
            </dl>
          </div>
        </section>
      </main>

      <button
        className="chat-launcher"
        type="button"
        onClick={() => setChatOpen(true)}
        aria-expanded={chatOpen}
        aria-controls="radio-chat"
      >
        <span className="chat-launcher-icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M4 5.5h16v11H9l-5 3v-14Z" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </span>
        <span><small>MESSENGER</small>Відкрити чат</span>
        <b>{messages.length}</b>
      </button>

      <div className={`chat-layer ${chatOpen ? 'is-open' : ''}`} aria-hidden={!chatOpen}>
        <button className="chat-scrim" type="button" onClick={() => setChatOpen(false)} aria-label="Закрити чат" />
        <section className="chat-drawer" id="radio-chat" role="dialog" aria-modal="true" aria-label="Чат Radio Vinnipeg">
          <header className="chat-header">
            <div>
              <span>RADIO VINNIPEG / MESSENGER</span>
              <h2>Чат ефіру</h2>
            </div>
            <button type="button" onClick={() => setChatOpen(false)} aria-label="Закрити чат">×</button>
          </header>
          <div className="chat-presence">
            <span><i />{online.length} слухачів онлайн</span>
            <div>
              {online.slice(0, 5).map((u, i) => (
                <span className="presence-dot" key={`${u.nickname}-${i}`} style={{ background: u.color }} title={u.nickname} />
              ))}
            </div>
          </div>
          <div className="chat-card">
            <div className="messages">
              {messages.length === 0 && (
                <div className="messages-empty">Тиша в чаті. Почніть розмову.</div>
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
                tabIndex={chatOpen ? 0 : -1}
              />
              <button type="submit" disabled={sending || !draft.trim()}>
                <span>Надіслати</span>
                <b aria-hidden>↗</b>
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}
