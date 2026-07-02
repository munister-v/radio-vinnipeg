import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ApiError,
  clearRoomChat,
  createRoom,
  deleteMessage,
  editMessage,
  fetchMessages,
  fetchOnline,
  fetchRooms,
  pollMessages,
  reactToMessage,
  renameMe,
  saveUser,
  sendMessage,
  sendTyping,
  type ChatMessage,
  type Reaction,
  type Room,
  type Typer,
  type User,
} from './api'
import { type VoiceStats } from './VoicePanel'
import ForestStage from './ForestStage'
import MusicRadio from './MusicRadio'
import EmojiPicker from './EmojiPicker'
import GifPicker from './GifPicker'
import { useI18n, type Lang } from './i18n'

function playMessagePing() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.45)
    osc.onended = () => ctx.close()
  } catch { /* AudioContext not available */ }
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="shortcuts-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('shortcuts.title')}>
      <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
        <header className="shortcuts-header">
          <h2>{t('shortcuts.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('chat.close')}>×</button>
        </header>
        <ul className="shortcuts-list">
          <li><kbd>C</kbd><span>{t('shortcuts.chat')}</span></li>
          <li><kbd>J</kbd><span>{t('shortcuts.join')}</span></li>
          <li><kbd>M</kbd><span>{t('shortcuts.mic')}</span></li>
          <li><kbd>Space</kbd><span>{t('shortcuts.ptt')}</span></li>
          <li><kbd>↑</kbd><span>{t('shortcuts.editLast')}</span></li>
          <li><kbd>Esc</kbd><span>{t('shortcuts.close')}</span></li>
          <li><kbd>?</kbd><span>{t('shortcuts.help')}</span></li>
        </ul>
      </div>
    </div>
  )
}

const MEDIA_RE = /^https?:\/\/\S+\.(gif|jpg|jpeg|png|webp)(\?.*)?$/i
const TENOR_RE = /^https?:\/\/media\.tenor\.com\//i
const GIPHY_RE = /^https?:\/\/media\d*\.giphy\.com\//i
const URL_RE = /(https?:\/\/[^\s]+)/g

function isMediaUrl(text: string): boolean {
  const t = text.trim()
  return MEDIA_RE.test(t) || TENOR_RE.test(t) || GIPHY_RE.test(t)
}

function MessageContent({ text }: { text: string }) {
  if (isMediaUrl(text)) {
    return (
      <div className="message-media">
        <img
          src={text.trim()}
          alt=""
          className="message-img"
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      </div>
    )
  }
  const parts = text.split(URL_RE)
  return (
    <>
      {parts.map((part, i) =>
        URL_RE.test(part)
          ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="msg-link">{part}</a>
          : part,
      )}
    </>
  )
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥']


// Winnipeg Nights mark: compact monogram, signal arcs and night horizon.
function BrandEmblem({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <rect x="3.5" y="3.5" width="41" height="41" stroke="currentColor" strokeWidth="2" />
      <path d="M10 33h28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".55" />
      <path d="M13 29l5-12 5 12 5-12 7 12" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 13a13 13 0 0 1 18 0M11 9a19 19 0 0 1 26 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity=".72" />
      <circle cx="24" cy="37.5" r="1.9" fill="currentColor" />
    </svg>
  )
}

function roomLabel(room: Room): string {
  return room.title
    .replace(/^Winn?ipeg Nights\s*·\s*/i, '')
    .replace(/^Vinnipeg Nights\s*·\s*/i, '')
    .trim() || room.slug
}



function formatDateSeparator(iso: string, lang: Lang): string {
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(normalized)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return lang === 'uk' ? 'Сьогодні' : 'Today'
  if (sameDay(d, yesterday)) return lang === 'uk' ? 'Вчора' : 'Yesterday'
  return d.toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-CA', { day: 'numeric', month: 'long', year: 'numeric' })
}

function isSameDay(a: string, b: string): boolean {
  const normalize = (s: string) => (s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
  const da = new Date(normalize(a))
  const db = new Date(normalize(b))
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

type Props = {
  user: User
  onUserChange: (u: User) => void
}

const CHAT_POLL_VISIBLE_MS = 5000
const CHAT_POLL_HIDDEN_MS = 30_000
const ROOMS_POLL_VISIBLE_MS = 10_000
const ROOMS_POLL_HIDDEN_MS = 45_000

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
    let timer: number | null = null
    const tick = () => {
      setNow(new Date())
      timer = window.setTimeout(tick, document.visibilityState === 'hidden' ? 120_000 : 30_000)
    }
    timer = window.setTimeout(tick, 30_000)
    const onVisibilityChange = () => {
      if (timer) window.clearTimeout(timer)
      tick()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      if (timer) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
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
  const [online, setOnline] = useState<{ nickname: string; color: string; city?: string }[]>([])
  const [typers, setTypers] = useState<Typer[]>([])
  const [chatOpen, setChatOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [lastReadId, setLastReadId] = useState(0)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [editingNick, setEditingNick] = useState(false)
  const [nickDraft, setNickDraft] = useState(user.nickname)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [gifOpen, setGifOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [scrollUnread, setScrollUnread] = useState(0)
  const [notifSound, setNotifSound] = useState(true)
  const [voiceStats, setVoiceStats] = useState<VoiceStats>(null)
  const [currentRoom, setCurrentRoom] = useState('lounge')
  const [rooms, setRooms] = useState<Room[]>([])
  const currentRoomRef = useRef('lounge')
  const notifSoundRef = useRef(true)
  const prevOnlineLenRef = useRef(0)
  const [mentionMatches, setMentionMatches] = useState<{ nickname: string; color: string }[]>([])
  const [mentionIdx, setMentionIdx] = useState(0)
  const lastIdRef = useRef(0)
  const initialLoadDoneRef = useRef(false)
  const lastTypingSentRef = useRef(0)
  const listEndRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const composerInputRef = useRef<HTMLInputElement>(null)
  const emojiBtnRef = useRef<HTMLButtonElement>(null)
  const gifBtnRef = useRef<HTMLButtonElement>(null)
  const pollRef = useRef<number | null>(null)
  const chatOpenRef = useRef(false)

  useEffect(() => {
    chatOpenRef.current = chatOpen
  }, [chatOpen])

  // Sync currentRoomRef whenever state changes (for use inside closures)
  useEffect(() => { currentRoomRef.current = currentRoom }, [currentRoom])

  // Rooms list — poll every 6s for in_call counts
  useEffect(() => {
    let timer: number | null = null
    let cancelled = false
    const load = () => fetchRooms().then(setRooms).catch(() => {})
    const schedule = (delay: number) => {
      timer = window.setTimeout(async () => {
        if (cancelled) return
        await load()
        schedule(document.visibilityState === 'hidden' ? ROOMS_POLL_HIDDEN_MS : ROOMS_POLL_VISIBLE_MS)
      }, delay)
    }
    load()
    schedule(ROOMS_POLL_VISIBLE_MS)
    const onVisibilityChange = () => {
      if (timer) window.clearTimeout(timer)
      schedule(document.visibilityState === 'hidden' ? ROOMS_POLL_HIDDEN_MS : 500)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    // Clear previous room messages on switch
    setMessages([])
    lastIdRef.current = 0
    initialLoadDoneRef.current = false

    async function init() {
      try {
        const initial = await fetchMessages(currentRoom)
        if (cancelled) return
        setMessages(initial)
        if (initial.length) {
          lastIdRef.current = initial[initial.length - 1].id
          setLastReadId(initial[initial.length - 1].id)
        }
      } catch (err) {
        if (err instanceof ApiError) setError(err.message)
      } finally {
        if (!cancelled) initialLoadDoneRef.current = true
      }
    }
    init()

    const tick = async () => {
      try {
        const result = await pollMessages(lastIdRef.current, currentRoomRef.current)
        const fresh = result.messages
        if (fresh.length) {
          lastIdRef.current = fresh[fresh.length - 1].id
          setMessages((prev) => [...prev, ...fresh])
          if (initialLoadDoneRef.current) {
            if (!chatOpenRef.current && notifSoundRef.current) playMessagePing()
            // If scrolled away, count as unread
            setScrollUnread((n) => {
              const container = messagesRef.current
              if (!container) return n
              const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80
              return atBottom ? 0 : n + fresh.length
            })
          }
        }
        setTypers(result.typing)
        // Apply reaction updates from server
        if (result.reaction_updates?.length) {
          setMessages((prev) => prev.map((m) => {
            const upd = result.reaction_updates.find((u) => u.message_id === m.id)
            return upd ? { ...m, reactions: upd.reactions } : m
          }))
        }
        if (document.visibilityState === 'visible' || chatOpenRef.current) {
          setOnline(await fetchOnline())
        }
      } catch {
        // ignore transient errors — chat is best-effort
      }
    }
    const pollChat = async () => {
      await tick()
      if (!cancelled) {
        pollRef.current = window.setTimeout(
          pollChat,
          document.visibilityState === 'hidden' ? CHAT_POLL_HIDDEN_MS : CHAT_POLL_VISIBLE_MS,
        )
      }
    }
    pollRef.current = window.setTimeout(pollChat, CHAT_POLL_VISIBLE_MS)
    // Миттєвий догін при поверненні на вкладку.
    const onVisible = () => {
      if (pollRef.current) window.clearTimeout(pollRef.current)
      pollRef.current = window.setTimeout(
        pollChat,
        document.visibilityState === 'hidden' ? CHAT_POLL_HIDDEN_MS : 400,
      )
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)

    return () => {
      cancelled = true
      if (pollRef.current) window.clearTimeout(pollRef.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [currentRoom]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (chatOpen) {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      setScrollUnread(0)
      window.setTimeout(() => composerInputRef.current?.focus(), 280)
    }
  }, [messages, chatOpen])

  // Track whether listEnd is visible → show scroll-to-bottom button
  useEffect(() => {
    const el = listEndRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      setShowScrollBtn(!entry.isIntersecting)
      if (entry.isIntersecting) setScrollUnread(0)
    }, { root: messagesRef.current, threshold: 0 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [chatOpen])

  // Mention autocomplete keyboard nav
  useEffect(() => {
    if (mentionMatches.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionMatches.length) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length) }
      else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(mentionMatches[mentionIdx].nickname)
      } else if (e.key === 'Escape') { setMentionMatches([]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mentionMatches, mentionIdx])

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

  // Auto-clear chat when everyone leaves (broadcast ended)
  useEffect(() => {
    if (prevOnlineLenRef.current > 0 && online.length === 0) {
      const timer = window.setTimeout(() => {
        clearRoomChat(currentRoomRef.current).catch(() => {})
        setMessages([])
        lastIdRef.current = 0
        initialLoadDoneRef.current = false
      }, 8000)
      return () => window.clearTimeout(timer)
    }
    prevOnlineLenRef.current = online.length
  }, [online.length])

  // C: toggle chat
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyC' || e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (chatOpen) closeChat()
      else openChat()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chatOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ?: toggle keyboard shortcuts help
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      setShortcutsOpen((v) => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function handleDraftChange(text: string) {
    setDraft(text)
    if (text.trim()) {
      const now = Date.now()
      if (now - lastTypingSentRef.current > 2500) {
        lastTypingSentRef.current = now
        sendTyping(currentRoomRef.current).catch(() => {})
      }
    }
    // @mention autocomplete
    const match = text.match(/@(\w*)$/)
    if (match) {
      const q = match[1].toLowerCase()
      const hits = online.filter((u) => u.nickname.toLowerCase().startsWith(q)).slice(0, 6)
      setMentionMatches(hits)
      setMentionIdx(0)
    } else {
      setMentionMatches([])
    }
  }

  function insertMention(nickname: string) {
    setDraft((d) => d.replace(/@\w*$/, `@${nickname} `))
    setMentionMatches([])
    composerInputRef.current?.focus()
  }

  async function handleReact(msgId: number, emoji: string) {
    try {
      const res = await reactToMessage(msgId, emoji)
      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, reactions: res.reactions } : m))
    } catch { /* ignore */ }
  }

  function startEdit(m: ChatMessage) {
    setEditingId(m.id)
    setEditDraft(m.text)
  }

  async function submitEdit(e: React.FormEvent, msgId: number) {
    e.preventDefault()
    const text = editDraft.trim()
    if (!text) return
    try {
      const res = await editMessage(msgId, text)
      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, text: res.text, edited_at: res.edited_at } : m))
      setEditingId(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('chat.sendError'))
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setError(null)
    const rid = replyTo?.id
    setReplyTo(null)
    try {
      const msg = await sendMessage(text, rid, currentRoomRef.current)
      setMessages((prev) => [...prev, msg])
      lastIdRef.current = msg.id
      setDraft('')
      listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
    <div className={`radio-shell${chatOpen ? ' chat-is-open' : ''}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#air" aria-label={t('top.toAir')}>
            <span className="brand-mark" aria-hidden><BrandEmblem className="brand-emblem" /></span>
            <div className="brand-titles">
              <span className="brand-eyebrow">{t('top.brandEyebrow')}</span>
              <span className="brand-name">Winnipeg Nights</span>
            </div>
          </a>
          <nav className="topbar-nav" aria-label="Winnipeg Nights">
            <a href="#air">{t('nav.air')}</a>
            <a href="#schedule">{t('nav.schedule')}</a>
            <a href="#about">{t('nav.about')}</a>
            <button type="button" onClick={openChat}>{t('nav.chat')}</button>
          </nav>
          <div className="topbar-right">
            {voiceStats && voiceStats.quality && (
              <div
                className={`conn-tray q-${voiceStats.quality}`}
                title={`RTT ${voiceStats.rttMs} ms · Loss ${voiceStats.lossPercent}%`}
                aria-label={`Connection quality: ${voiceStats.quality}, RTT ${voiceStats.rttMs} ms`}
              >
                <span className="conn-bars" aria-hidden>
                  {[1, 2, 3].map((b) => (
                    <i key={b} className={b <= (voiceStats.quality === 'good' ? 3 : voiceStats.quality === 'ok' ? 2 : 1) ? 'on' : ''} />
                  ))}
                </span>
                <span className="conn-tray-stats" aria-hidden>
                  <b>{voiceStats.rttMs}<small>ms</small></b>
                  <b>{voiceStats.lossPercent}<small>%</small></b>
                </span>
              </div>
            )}
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

      {/* ── Rooms bar ── */}
      {rooms.length > 0 && (
        <div className="rooms-bar" role="tablist" aria-label="Channels">
          {rooms.map((r) => (
            <button
              key={r.slug}
              role="tab"
              aria-selected={currentRoom === r.slug}
              className={`room-tab${currentRoom === r.slug ? ' active' : ''}`}
              onClick={() => setCurrentRoom(r.slug)}
              title={r.title}
            >
              <span className="room-tab-hash">#</span>
              <span className="room-tab-copy">
                <span className="room-tab-name">{roomLabel(r)}</span>
                <span className="room-tab-meta">
                  {r.now_playing?.title ? r.now_playing.title : r.in_call > 0 ? 'live voice' : r.slug}
                </span>
              </span>
              {r.in_call > 0 && <span className="room-tab-live">{r.in_call}</span>}
            </button>
          ))}
          <button
            className="room-tab room-tab-add"
            title="Створити канал"
            onClick={async () => {
              const title = window.prompt('Назва каналу:')
              if (!title?.trim()) return
              const room = await createRoom(title.trim()).catch(() => null)
              if (room) { setRooms((prev) => [...prev, room]); setCurrentRoom(room.slug) }
            }}
          >+</button>
        </div>
      )}

      <main>
        <ForestStage user={user} onStats={setVoiceStats} room={currentRoom} />

        <MusicRadio />

        <section className="schedule-section" id="schedule">
          <div className="schedule-head">
            <span className="schedule-eyebrow">{t('schedule.kicker')}</span>
            <h2 dangerouslySetInnerHTML={{ __html: t('schedule.heading') }} />
          </div>
          <StationClock />
          <ol className="schedule-list">
            {slotTimes.map((slot, index) => (
              <li key={slot.start} className="schedule-row">
                <time className="schedule-time">{String(slot.start).padStart(2, '0')}:00</time>
                <div className="schedule-body">
                  <h3>{t(`slot.${index}.label`)}</h3>
                  <p>{t(`slot.${index}.note`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="radio-manifesto" id="about">
          <span className="schedule-eyebrow">{t('about.kicker')}</span>
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

      <aside className="mobile-air-dock" aria-label="Winnipeg Nights">
        <a href="#air">
          <span><i />ON AIR</span>
          <strong>Winnipeg Nights</strong>
        </a>
        <button type="button" onClick={openChat} aria-label={t('chat.open')}>
          {t('chat.dockChat')}{unreadCount > 0 ? ` · ${unreadCount}` : ''}
        </button>
      </aside>

      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}

      <div className={`chat-layer ${chatOpen ? 'is-open' : ''}`} aria-hidden={!chatOpen}>
        <button className="chat-scrim" type="button" onClick={closeChat} aria-label={t('chat.close')} />
        <section className="chat-drawer" id="radio-chat" role="dialog" aria-modal="true" aria-label={t('chat.headerTitle')}>
          <header className="chat-header">
            <span className="chat-channel-name"># {currentRoom}</span>
            <div className="chat-header-actions">
              <button
                type="button"
                className="chat-clear-btn"
                onClick={async () => {
                  if (!window.confirm('Очистити чат?')) return
                  await clearRoomChat(currentRoomRef.current).catch(() => {})
                  setMessages([])
                  lastIdRef.current = 0
                }}
                title="Очистити чат"
                aria-label="Очистити чат"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </button>
              <button
                type="button"
                className="chat-notif-btn"
                onClick={() => {
                  const next = !notifSoundRef.current
                  notifSoundRef.current = next
                  setNotifSound(next)
                }}
                aria-pressed={notifSound}
                title={notifSound ? 'Звук увімкнено' : 'Звук вимкнено'}
                aria-label={notifSound ? 'Вимкнути звук' : 'Увімкнути звук'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  {!notifSound && <line x1="2" y1="2" x2="22" y2="22"/>}
                </svg>
              </button>
              <button
                type="button"
                className="chat-shortcuts-btn"
                onClick={() => setShortcutsOpen(true)}
                title={t('shortcuts.title')}
                aria-label={t('shortcuts.title')}
              >?</button>
              <button type="button" onClick={closeChat} aria-label={t('chat.close')}>×</button>
            </div>
          </header>
          <div className="chat-presence">
            <span><i />{t('chat.presence', { n: online.length })}</span>
            <div>
              {online.slice(0, 5).map((u, i) => (
                <span className="presence-dot" key={`${u.nickname}-${i}`} style={{ background: u.color }} title={[u.nickname, u.city].filter(Boolean).join(' · ')} />
              ))}
            </div>
          </div>
          <div className="chat-card">
            <div className="messages" ref={messagesRef}>
              {messages.length === 0 && (
                <div className="messages-empty">
                  <span aria-hidden>RV / 01</span>
                  <strong>{t('chat.emptyTitle')}</strong>
                  <p>{t('chat.emptyCopy')}</p>
                </div>
              )}
              {messages.map((m, idx) => {
                const prev = messages[idx - 1]
                const grouped = !!prev && prev.user_id === m.user_id && !prev.is_deleted && !m.is_deleted
                  && isSameDay(prev.created_at, m.created_at)
                const showSep = !prev || !isSameDay(prev.created_at, m.created_at)
                const mine = m.user_id === user.id
                const isMedia = isMediaUrl(m.text)
                const isEditing = editingId === m.id
                return (
                  <div key={m.id}>
                    {showSep && (
                      <div className="date-separator" aria-label={formatDateSeparator(m.created_at, lang)}>
                        <span>{formatDateSeparator(m.created_at, lang)}</span>
                      </div>
                    )}
                    <div className={`message ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} msg-enter`}>
                      {!grouped
                        ? <span
                            className="msg-avatar-circle"
                            style={{ background: mine ? user.color : m.color }}
                            title={[mine ? user.nickname : m.nickname, mine ? user.city : m.city].filter(Boolean).join(' · ')}
                            aria-hidden
                          >
                            {(mine ? user.nickname : m.nickname).slice(0, 2).toUpperCase()}
                          </span>
                        : <span className="msg-avatar-spacer" aria-hidden />
                      }
                      <div className="msg-content">
                        {/* Hover action bar */}
                        {!m.is_deleted && !isEditing && (
                          <div className="message-actions">
                            <div className="quick-react-bar">
                              {QUICK_EMOJIS.map((e) => (
                                <button key={e} type="button" className="qr-btn" onClick={() => handleReact(m.id, e)} title={e}>{e}</button>
                              ))}
                            </div>
                            <button type="button" className="action-btn" onClick={() => setReplyTo(m)} title={t('chat.reply')}>↩</button>
                            {mine && <button type="button" className="action-btn" onClick={() => startEdit(m)} title={t('chat.edit')}>✎</button>}
                            {mine && <button type="button" className="action-btn danger" onClick={() => handleDelete(m.id)} title={t('chat.delete')}>✕</button>}
                          </div>
                        )}

                        {/* Reply preview (if this message is a reply) */}
                        {m.reply_to && !m.is_deleted && (
                          <div className="reply-preview">
                            <span className="reply-author" style={{ color: m.reply_to.color }}>{m.reply_to.nickname}</span>
                            <p className="reply-text">{m.reply_to.text}</p>
                          </div>
                        )}

                        {!grouped && (
                          <div className="message-meta">
                            <span className="message-author" style={{ color: mine ? user.color : m.color }}>
                              {mine ? t('voice.you') : m.nickname}
                            </span>
                            {(mine ? user.city : m.city) && (
                              <span className="message-city">{mine ? user.city : m.city}</span>
                            )}
                            <span className="message-time">{formatTime(m.created_at, lang)}</span>
                            {m.edited_at && <span className="edited-tag">{t('chat.edited')}</span>}
                          </div>
                        )}

                        {/* Inline edit form */}
                        {isEditing ? (
                          <form className="message-edit-form" onSubmit={(e) => submitEdit(e, m.id)}>
                            <input
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              maxLength={1000}
                              autoFocus
                            />
                            <div className="edit-hint">
                              <span>{t('chat.editEsc')}</span>
                              <button type="button" onClick={() => setEditingId(null)}>{t('chat.cancel')}</button>
                              <button type="submit" disabled={!editDraft.trim()}>{t('chat.save')}</button>
                            </div>
                          </form>
                        ) : (
                          <div className={`message-bubble ${m.is_deleted ? 'deleted' : ''} ${isMedia ? 'media-bubble' : ''}`}>
                            {m.is_deleted ? m.text : <MessageContent text={m.text} />}
                            {!m.is_deleted && grouped && m.edited_at && (
                              <span className="edited-tag-inline">{t('chat.edited')}</span>
                            )}
                          </div>
                        )}

                        {/* Reactions */}
                        {m.reactions.length > 0 && !m.is_deleted && (
                          <div className="reactions">
                            {m.reactions.map((r: Reaction) => (
                              <button
                                key={r.emoji}
                                type="button"
                                className={`reaction-pill ${r.reacted ? 'reacted' : ''}`}
                                onClick={() => handleReact(m.id, r.emoji)}
                                title={r.reacted ? t('chat.unreact') : t('chat.react')}
                              >
                                {r.emoji} <span>{r.count}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={listEndRef} />
            </div>

            {/* Scroll-to-bottom button */}
            {showScrollBtn && (
              <button
                type="button"
                className="scroll-to-bottom"
                onClick={() => {
                  listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                  setScrollUnread(0)
                }}
                aria-label={t('chat.scrollToBottom')}
              >
                ↓{scrollUnread > 0 && <b>{scrollUnread}</b>}
              </button>
            )}

            {typers.length > 0 && (
              <div className="chat-typing" aria-live="polite">
                <span className="typing-dots" aria-hidden><i /><i /><i /></span>
                <span>
                  {typers.length === 1
                    ? t('chat.typing', { name: typers[0].nickname })
                    : t('chat.typingMulti', { n: typers.length })}
                </span>
              </div>
            )}

            {error && <div className="error banner">{error}</div>}

            <div className="composer-wrap">
              {/* Reply banner */}
              {replyTo && (
                <div className="reply-banner">
                  <span className="reply-banner-label">{t('chat.replyingTo')}</span>
                  <span className="reply-banner-nick" style={{ color: replyTo.color }}>{replyTo.nickname}</span>
                  <span className="reply-banner-text">{replyTo.text.slice(0, 80)}</span>
                  <button type="button" className="reply-banner-close" onClick={() => setReplyTo(null)} aria-label={t('chat.cancel')}>×</button>
                </div>
              )}

              {/* @mention dropdown */}
              {mentionMatches.length > 0 && (
                <div className="mention-dropdown">
                  {mentionMatches.map((u, i) => (
                    <button
                      key={u.nickname}
                      type="button"
                      className={`mention-item ${i === mentionIdx ? 'active' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); insertMention(u.nickname) }}
                    >
                      <span className="dot" style={{ background: u.color }} />
                      <span>{u.nickname}</span>
                    </button>
                  ))}
                </div>
              )}

              {emojiOpen && (
                <EmojiPicker
                  anchorRef={emojiBtnRef}
                  onClose={() => setEmojiOpen(false)}
                  onPick={(emoji) => {
                    setDraft((d) => d + emoji)
                    composerInputRef.current?.focus()
                  }}
                />
              )}
              {gifOpen && (
                <GifPicker
                  anchorRef={gifBtnRef}
                  onClose={() => setGifOpen(false)}
                  onPick={async (url) => {
                    setGifOpen(false)
                    setSending(true)
                    try {
                      const msg = await sendMessage(url)
                      setMessages((prev) => [...prev, msg])
                      lastIdRef.current = msg.id
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : t('chat.sendError'))
                    } finally {
                      setSending(false)
                    }
                  }}
                />
              )}
              <div className="composer-extras">
                <button
                  ref={emojiBtnRef}
                  type="button"
                  className={`composer-extra-btn ${emojiOpen ? 'active' : ''}`}
                  onClick={() => { setEmojiOpen((v) => !v); setGifOpen(false) }}
                  title="Емодзі"
                  aria-label="Вставити емодзі"
                  tabIndex={chatOpen ? 0 : -1}
                ><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1 1.2 5.5 1.2 7 0"/><circle cx="9.5" cy="10" r=".6" fill="currentColor" stroke="none"/><circle cx="14.5" cy="10" r=".6" fill="currentColor" stroke="none"/></svg></button>
                <button
                  ref={gifBtnRef}
                  type="button"
                  className={`composer-extra-btn ${gifOpen ? 'active' : ''}`}
                  onClick={() => { setGifOpen((v) => !v); setEmojiOpen(false) }}
                  title="GIF"
                  aria-label="Вставити GIF"
                  tabIndex={chatOpen ? 0 : -1}
                >GIF</button>
              </div>
              <form className="composer" onSubmit={handleSend}>
                <div className="composer-field">
                  <input
                    ref={composerInputRef}
                    value={draft}
                    onChange={(e) => handleDraftChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp' && !draft.trim()) {
                        const lastMine = [...messages].reverse().find(m => m.user_id === user.id && !m.is_deleted)
                        if (lastMine) { e.preventDefault(); startEdit(lastMine) }
                      }
                    }}
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
          </div>
        </section>
      </div>
    </div>
  )
}
