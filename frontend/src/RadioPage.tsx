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
import { setBackgroundInterval, type BgTimer } from './bgTimer'

type Props = {
  user: User
  onUserChange: (u: User) => void
}

const POLL_INTERVAL_MS = 3000

const stationSlots = [
  { start: 0, end: 8, label: 'Нічний відкритий ефір', note: 'Тиха розмова без заданої теми' },
  { start: 8, end: 12, label: 'Ранковий сигнал', note: 'Початок дня разом зі слухачами' },
  { start: 12, end: 18, label: 'Денна розмова', note: 'Вільний мікрофон і живі включення' },
  { start: 18, end: 24, label: 'Вечірній відкритий мікрофон', note: 'Головний розмовний слот станції' },
]

function formatTime(iso: string): string {
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
}

function StationClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const hour = now.getHours()
  const slotIndex = stationSlots.findIndex((slot) => hour >= slot.start && hour < slot.end)
  const activeIndex = slotIndex === -1 ? 0 : slotIndex
  const active = stationSlots[activeIndex]
  const next = stationSlots[(activeIndex + 1) % stationSlots.length]
  const elapsed = now.getHours() + now.getMinutes() / 60 - active.start
  const progress = Math.min(100, Math.max(0, (elapsed / (active.end - active.start)) * 100))

  return (
    <section className="station-clock" aria-label="Поточний ритм станції">
      <div className="station-clock-now">
        <span>Зараз / {now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</span>
        <h2>{active.label}</h2>
        <p>{active.note}</p>
      </div>
      <div className="station-progress" aria-label={`Поточний слот завершено на ${Math.round(progress)} відсотків`}>
        <i style={{ transform: `scaleX(${progress / 100})` }} />
      </div>
      <div className="station-clock-next">
        <span>Далі / {String(active.end % 24).padStart(2, '0')}:00</span>
        <strong>{next.label}</strong>
      </div>
    </section>
  )
}

export default function RadioPage({ user, onUserChange }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [online, setOnline] = useState<{ nickname: string; color: string }[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [lastReadId, setLastReadId] = useState(0)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [editingNick, setEditingNick] = useState(false)
  const [nickDraft, setNickDraft] = useState(user.nickname)
  const lastIdRef = useRef(0)
  const listEndRef = useRef<HTMLDivElement>(null)
  const composerInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<BgTimer | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const initial = await fetchMessages()
        if (cancelled) return
        setMessages(initial)
        if (initial.length) {
          lastIdRef.current = initial[initial.length - 1].id
          setLastReadId(initial[initial.length - 1].id)
        }
      } catch (err) {
        if (err instanceof ApiError) setError(err.message)
      }
    }
    init()

    const tick = async () => {
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
    }
    // Воркер-таймер: опитування чату не «залипає» при згорнутій/заблокованій вкладці.
    pollRef.current = setBackgroundInterval(tick, POLL_INTERVAL_MS)
    // Миттєвий догін при поверненні на вкладку.
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)

    return () => {
      cancelled = true
      pollRef.current?.stop()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [])

  useEffect(() => {
    if (chatOpen) {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      window.setTimeout(() => composerInputRef.current?.focus(), 280)
    }
  }, [messages, chatOpen])

  useEffect(() => {
    if (!chatOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const latestId = messages.at(-1)?.id
        if (latestId) setLastReadId(latestId)
        setChatOpen(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [chatOpen, messages])

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

  const openChat = () => {
    const latestId = messages.at(-1)?.id
    if (latestId) setLastReadId(latestId)
    setChatOpen(true)
  }

  const closeChat = () => {
    const latestId = messages.at(-1)?.id
    if (latestId) setLastReadId(latestId)
    setChatOpen(false)
  }

  const unreadCount = chatOpen ? 0 : messages.filter((message) => message.id > lastReadId).length

  return (
    <div className="radio-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#air" aria-label="Radio Vinnipeg — до ефіру">
            <span className="brand-mark" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
                strokeLinecap="round" strokeLinejoin="round">
                {/* Передавач: щогла + сигнал, що випромінюється */}
                <circle className="brand-core" cx="12" cy="8" r="2" fill="currentColor" stroke="none" />
                <path d="M12 10v8" />
                <path d="M8.5 18h7" />
                <path className="brand-wave brand-wave-l" d="M8.6 4.6a5 5 0 0 0 0 6.8" />
                <path className="brand-wave brand-wave-r" d="M15.4 4.6a5 5 0 0 1 0 6.8" />
                <path className="brand-wave brand-wave-l2" d="M6.1 2.6a8.5 8.5 0 0 0 0 10.8" />
                <path className="brand-wave brand-wave-r2" d="M17.9 2.6a8.5 8.5 0 0 1 0 10.8" />
              </svg>
            </span>
            <div className="brand-titles">
              <span className="brand-eyebrow">Munister / Radio 01</span>
              <span className="brand-name">Radio Vinnipeg</span>
            </div>
          </a>
          <nav className="topbar-nav" aria-label="Головна навігація">
            <a href="#air">Ефір</a>
            <a href="#schedule">Розклад</a>
            <a href="#about">Про радіо</a>
            <button type="button" onClick={openChat}>Чат</button>
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
            <p>Відкрите радіо, де слухач може стати голосом ефіру</p>
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

        <section className="schedule-section" id="schedule">
          <div className="schedule-heading">
            <div className="section-kicker"><span>02</span> Ритм станції</div>
            <h2>Зараз.<br />Далі.</h2>
          </div>
          <StationClock />
          <ol className="schedule-grid">
            {stationSlots.map((slot, index) => (
              <li key={slot.start}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <time>{String(slot.start).padStart(2, '0')}:00</time>
                <h3>{slot.label}</h3>
                <p>{slot.note}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="radio-manifesto" id="about">
          <div className="section-kicker"><span>03</span> Радіо як спільний простір</div>
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
        onClick={openChat}
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
        <b aria-label={`${unreadCount} непрочитаних повідомлень`}>{unreadCount}</b>
      </button>

      <aside className="mobile-air-dock" aria-label="Швидкий доступ до ефіру">
        <a href="#air">
          <span><i />ON AIR</span>
          <strong>Radio Vinnipeg</strong>
        </a>
        <button type="button" onClick={openChat} aria-label="Відкрити чат">
          Чат{unreadCount > 0 ? ` · ${unreadCount}` : ''}
        </button>
      </aside>

      <div className={`chat-layer ${chatOpen ? 'is-open' : ''}`} aria-hidden={!chatOpen}>
        <button className="chat-scrim" type="button" onClick={closeChat} aria-label="Закрити чат" />
        <section className="chat-drawer" id="radio-chat" role="dialog" aria-modal="true" aria-label="Чат Radio Vinnipeg">
          <header className="chat-header">
            <div>
              <span>RADIO VINNIPEG / MESSENGER</span>
              <h2>Чат ефіру</h2>
            </div>
            <button type="button" onClick={closeChat} aria-label="Закрити чат">×</button>
          </header>
          <div className="chat-context">
            <span>LIVE CHANNEL / 01</span>
            <strong>Розмова навколо ефіру</strong>
            <p>Коментуйте почуте або запропонуйте тему для відкритого мікрофона.</p>
          </div>
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
                <div className="messages-empty">
                  <span aria-hidden>RV / 01</span>
                  <strong>Чат ще мовчить</strong>
                  <p>Напишіть перше повідомлення або запропонуйте тему для ефіру.</p>
                </div>
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
              <div className="composer-field">
                <input
                  ref={composerInputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Напишіть як ${user.nickname}…`}
                  aria-label="Повідомлення в чат ефіру"
                  maxLength={1000}
                  tabIndex={chatOpen ? 0 : -1}
                />
                <span>{draft.length} / 1000</span>
              </div>
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
