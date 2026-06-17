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
import { useI18n, type Lang } from './i18n'

type Props = {
  user: User
  onUserChange: (u: User) => void
}

const POLL_INTERVAL_MS = 3000

const slotTimes = [
  { start: 0, end: 8 },
  { start: 8, end: 12 },
  { start: 12, end: 18 },
  { start: 18, end: 24 },
]

function localeOf(lang: Lang): string {
  return lang === 'uk' ? 'uk-UA' : 'en-CA'
}

function formatTime(iso: string, lang: Lang): string {
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(localeOf(lang), { hour: '2-digit', minute: '2-digit' })
}

function StationClock() {
  const { t, lang } = useI18n()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const hour = now.getHours()
  const slotIndex = slotTimes.findIndex((slot) => hour >= slot.start && hour < slot.end)
  const activeIndex = slotIndex === -1 ? 0 : slotIndex
  const active = slotTimes[activeIndex]
  const nextIndex = (activeIndex + 1) % slotTimes.length
  const elapsed = now.getHours() + now.getMinutes() / 60 - active.start
  const progress = Math.min(100, Math.max(0, (elapsed / (active.end - active.start)) * 100))
  const timeStr = now.toLocaleTimeString(localeOf(lang), { hour: '2-digit', minute: '2-digit' })

  return (
    <section className="station-clock" aria-label={t('clock.aria')}>
      <div className="station-clock-now">
        <span>{t('clock.now', { time: timeStr })}</span>
        <h2>{t(`slot.${activeIndex}.label`)}</h2>
        <p>{t(`slot.${activeIndex}.note`)}</p>
      </div>
      <div className="station-progress" aria-label={t('clock.progress', { pct: Math.round(progress) })}>
        <i style={{ transform: `scaleX(${progress / 100})` }} />
      </div>
      <div className="station-clock-next">
        <span>{t('clock.next', { time: `${String(active.end % 24).padStart(2, '0')}:00` })}</span>
        <strong>{t(`slot.${nextIndex}.label`)}</strong>
      </div>
    </section>
  )
}

export default function RadioPage({ user, onUserChange }: Props) {
  const { t, lang, setLang } = useI18n()
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
      setError(err instanceof ApiError ? err.message : t('chat.sendError'))
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteMessage(id)
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, text: t('chat.deleted'), is_deleted: true } : m)),
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
      setError(err instanceof ApiError ? err.message : t('chat.renameError'))
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
          <a className="brand" href="#air" aria-label={t('top.toAir')}>
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
              <span className="brand-eyebrow">{t('top.brandEyebrow')}</span>
              <span className="brand-name">Radio Vinnipeg</span>
            </div>
          </a>
          <nav className="topbar-nav" aria-label="Radio Vinnipeg">
            <a href="#air">{t('nav.air')}</a>
            <a href="#schedule">{t('nav.schedule')}</a>
            <a href="#about">{t('nav.about')}</a>
            <button type="button" onClick={openChat}>{t('nav.chat')}</button>
          </nav>
          <div className="topbar-right">
            <div className="lang-switch" role="group" aria-label="Language">
              <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} aria-pressed={lang === 'en'}>EN</button>
              <button type="button" className={lang === 'uk' ? 'on' : ''} onClick={() => setLang('uk')} aria-pressed={lang === 'uk'}>UA</button>
            </div>
            <span className="online-pill"><span className="dot-live" />{t('top.online', { n: online.length })}</span>
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
                title={t('top.changeNick')}
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
            <div className="section-kicker"><span>01</span> {t('hero.kicker')}</div>
            <h1>Radio<br />Vinnipeg</h1>
            <p>{t('hero.tagline')}</p>
          </div>
          <div className="frequency" aria-label="Radio Vinnipeg — 24/7">
            <span>{t('freq.onair')}</span>
            <strong>24/7</strong>
            <small>{t('freq.web')}</small>
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
            <div className="section-kicker"><span>02</span> {t('schedule.kicker')}</div>
            <h2 dangerouslySetInnerHTML={{ __html: t('schedule.heading') }} />
          </div>
          <StationClock />
          <ol className="schedule-grid">
            {slotTimes.map((slot, index) => (
              <li key={slot.start}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <time>{String(slot.start).padStart(2, '0')}:00</time>
                <h3>{t(`slot.${index}.label`)}</h3>
                <p>{t(`slot.${index}.note`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="radio-manifesto" id="about">
          <div className="section-kicker"><span>03</span> {t('about.kicker')}</div>
          <h2 dangerouslySetInnerHTML={{ __html: t('about.heading') }} />
          <div className="manifesto-copy">
            <p>{t('about.copy')}</p>
            <dl>
              <div><dt>{t('about.accessT')}</dt><dd>{t('about.accessD')}</dd></div>
              <div><dt>{t('about.formatT')}</dt><dd>{t('about.formatD')}</dd></div>
              <div><dt>{t('about.connT')}</dt><dd>{t('about.connD')}</dd></div>
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
        <span><small>{t('chat.launcherKicker')}</small>{t('chat.open')}</span>
        <b aria-label={t('chat.unreadAria', { n: unreadCount })}>{unreadCount}</b>
      </button>

      <aside className="mobile-air-dock" aria-label="Radio Vinnipeg">
        <a href="#air">
          <span><i />ON AIR</span>
          <strong>Radio Vinnipeg</strong>
        </a>
        <button type="button" onClick={openChat} aria-label={t('chat.open')}>
          {t('chat.dockChat')}{unreadCount > 0 ? ` · ${unreadCount}` : ''}
        </button>
      </aside>

      <div className={`chat-layer ${chatOpen ? 'is-open' : ''}`} aria-hidden={!chatOpen}>
        <button className="chat-scrim" type="button" onClick={closeChat} aria-label={t('chat.close')} />
        <section className="chat-drawer" id="radio-chat" role="dialog" aria-modal="true" aria-label={t('chat.headerTitle')}>
          <header className="chat-header">
            <div>
              <span>{t('chat.headerKicker')}</span>
              <h2>{t('chat.headerTitle')}</h2>
            </div>
            <button type="button" onClick={closeChat} aria-label={t('chat.close')}>×</button>
          </header>
          <div className="chat-context">
            <span>{t('chat.contextKicker')}</span>
            <strong>{t('chat.contextTitle')}</strong>
            <p>{t('chat.contextCopy')}</p>
          </div>
          <div className="chat-presence">
            <span><i />{t('chat.presence', { n: online.length })}</span>
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
                  <strong>{t('chat.emptyTitle')}</strong>
                  <p>{t('chat.emptyCopy')}</p>
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`message ${m.user_id === user.id ? 'mine' : ''}`}>
                  <div className="message-meta">
                    <span className="message-author" style={{ color: m.user_id === user.id ? undefined : m.color }}>{m.nickname}</span>
                    <span className="message-time">{formatTime(m.created_at, lang)}</span>
                  </div>
                  <div className={`message-bubble ${m.is_deleted ? 'deleted' : ''}`}>
                    {m.text}
                    {!m.is_deleted && m.user_id === user.id && (
                      <button className="delete-btn" title={t('chat.delete')} onClick={() => handleDelete(m.id)}>
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
                  placeholder={t('chat.placeholder', { nick: user.nickname })}
                  aria-label={t('chat.inputAria')}
                  maxLength={1000}
                  tabIndex={chatOpen ? 0 : -1}
                />
                <span>{draft.length} / 1000</span>
              </div>
              <button type="submit" disabled={sending || !draft.trim()}>
                <span>{t('chat.send')}</span>
                <b aria-hidden>↗</b>
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}
