import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ApiError,
  deleteMessage,
  editMessage,
  fetchMessages,
  fetchOnline,
  pollMessages,
  reactToMessage,
  renameMe,
  saveUser,
  sendMessage,
  sendTyping,
  type ChatMessage,
  type Reaction,
  type Typer,
  type User,
} from './api'
import VoicePanel from './VoicePanel'
import EmojiPicker from './EmojiPicker'
import GifPicker from './GifPicker'
import { setBackgroundInterval, type BgTimer } from './bgTimer'
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

function PineRow() {
  const pts = [
    "0,72 14,7 26,72","22,72 37,26 52,72","49,72 60,14 71,72","68,72 79,33 90,72",
    "87,72 101,2 115,72","111,72 122,20 133,72","129,72 142,11 155,72",
    "152,72 160,38 168,72","165,72 178,9 192,72","189,72 200,26 211,72",
    "208,72 221,5 234,72","231,72 240,30 249,72","246,72 260,15 274,72",
    "271,72 282,22 293,72","290,72 304,4 318,72","315,72 324,33 333,72",
    "330,72 344,11 358,72","355,72 365,36 375,72","372,72 385,7 398,72",
    "395,72 405,24 415,72","412,72 427,3 442,72","439,72 449,19 459,72",
    "456,72 468,13 480,72","477,72 487,32 497,72","494,72 508,6 522,72",
    "519,72 529,26 539,72","536,72 549,10 562,72","559,72 569,34 579,72",
    "576,72 590,2 604,72","601,72 611,21 621,72","618,72 632,14 646,72",
    "643,72 653,37 663,72","660,72 674,5 688,72","685,72 695,23 705,72",
    "702,72 715,12 728,72","725,72 735,31 745,72","742,72 756,7 770,72",
    "767,72 777,26 787,72","784,72 798,4 812,72","809,72 819,19 829,72",
    "826,72 840,14 854,72","851,72 861,33 871,72","868,72 882,8 896,72",
    "893,72 903,25 913,72","910,72 924,10 938,72","935,72 945,35 955,72",
    "952,72 966,3 980,72","977,72 987,22 997,72","994,72 1008,13 1022,72",
    "1019,72 1029,30 1039,72","1036,72 1050,6 1064,72","1061,72 1071,24 1081,72",
    "1078,72 1092,15 1106,72","1103,72 1113,36 1123,72","1120,72 1134,4 1148,72",
    "1145,72 1155,23 1165,72","1162,72 1176,11 1190,72","1187,72 1197,30 1207,72",
    "1204,72 1218,8 1232,72","1229,72 1239,27 1249,72","1246,72 1260,16 1274,72",
    "1271,72 1281,33 1291,72","1288,72 1302,5 1316,72","1313,72 1323,21 1333,72",
    "1330,72 1344,12 1358,72","1355,72 1365,34 1375,72","1372,72 1386,7 1400,72",
    "1397,72 1419,19 1440,72",
  ]
  return (
    <div className="pine-row" aria-hidden>
      <svg viewBox="0 0 1440 72" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        {pts.map((p, i) => <polygon key={i} points={p} />)}
      </svg>
    </div>
  )
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
  const notifSoundRef = useRef(true)
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
      } finally {
        if (!cancelled) initialLoadDoneRef.current = true
      }
    }
    init()

    const tick = async () => {
      try {
        const result = await pollMessages(lastIdRef.current)
        const fresh = result.messages
        if (fresh.length) {
          lastIdRef.current = fresh[fresh.length - 1].id
          setMessages((prev) => [...prev, ...fresh])
          if (initialLoadDoneRef.current) {
            if (!chatOpen && notifSoundRef.current) playMessagePing()
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
        sendTyping().catch(() => {})
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
      const msg = await sendMessage(text, rid)
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
            <span className="brand-mark" aria-hidden>RV</span>
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
            <div className="geo-coord" aria-hidden>49°46′N · 97°14′W · Winnipeg MB</div>
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

        <PineRow />

        <div className="radio-ticker" aria-hidden>
          <span>LIVE BROADCAST</span>
          <i />
          <span>WINNIPEG · MB</span>
          <i />
          <span>49°46′N · 97°14′W</span>
          <i />
          <span>OPEN MICROPHONE</span>
          <i />
          <span>INDEPENDENT RADIO</span>
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

      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}

      <div className={`chat-layer ${chatOpen ? 'is-open' : ''}`} aria-hidden={!chatOpen}>
        <button className="chat-scrim" type="button" onClick={closeChat} aria-label={t('chat.close')} />
        <section className="chat-drawer" id="radio-chat" role="dialog" aria-modal="true" aria-label={t('chat.headerTitle')}>
          <header className="chat-header">
            <div className="chat-header-identity">
              <div className="chat-server-mark" aria-hidden>RV</div>
              <div className="chat-server-info">
                <strong>Radio Vinnipeg</strong>
                <span># lounge</span>
              </div>
            </div>
            <div className="chat-header-actions">
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
                <span className="presence-dot" key={`${u.nickname}-${i}`} style={{ background: u.color }} title={u.nickname} />
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
