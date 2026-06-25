import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'uk'

const STORAGE_KEY = 'rv-lang'

// Англійська — мова за замовчуванням; українська доступна перемикачем.
function detectInitial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'uk') return saved
  } catch { /* ignore */ }
  return 'en'
}

type Dict = Record<string, string>

const en: Dict = {
  // App
  'app.loading': 'Tuning the broadcast…',
  'app.connectError': "Couldn't connect to the radio. Please refresh the page.",
  // Nav / topbar
  'nav.air': 'On Air',
  'nav.schedule': 'Schedule',
  'nav.about': 'About',
  'nav.chat': 'Chat',
  'top.brandEyebrow': 'Munister / Radio 01',
  'top.online': 'On air · {n}',
  'top.changeNick': 'Change nickname',
  'top.toAir': 'Radio Vinnipeg — to the broadcast',
  // Hero
  'hero.kicker': 'Independent live broadcast',
  'hero.tagline': 'Open radio where a listener can become the voice on air',
  'freq.onair': 'ON AIR',
  'freq.web': 'WEB FREQUENCY',
  // Schedule
  'schedule.kicker': 'Station rhythm',
  'schedule.heading': 'Now.<br />Next.',
  'clock.aria': 'Current station rhythm',
  'clock.now': 'Now / {time}',
  'clock.next': 'Next / {time}',
  'clock.progress': 'Current slot is {pct}% complete',
  'slot.0.label': 'Night open air', 'slot.0.note': 'Quiet talk with no set topic',
  'slot.1.label': 'Morning signal', 'slot.1.note': 'Starting the day with listeners',
  'slot.2.label': 'Daytime talk', 'slot.2.note': 'Free mic and live call-ins',
  'slot.3.label': 'Evening open mic', 'slot.3.note': "The station's main talk slot",
  // Manifesto
  'about.kicker': 'Radio as a shared space',
  'about.heading': 'Not a playlist.<br />Live people.',
  'about.copy': 'Listen to the live conversation, or jump in with your mic whenever you have something to say.',
  'about.accessT': 'Access', 'about.accessD': 'no sign-up',
  'about.formatT': 'Format', 'about.formatD': 'open microphone',
  'about.connT': 'Connection', 'about.connD': 'live in the browser',
  // Chat
  'chat.launcherKicker': 'Messenger',
  'chat.open': 'Open chat',
  'chat.close': 'Close chat',
  'chat.unreadAria': '{n} unread messages',
  'chat.dockChat': 'Chat',
  'chat.headerKicker': 'Radio Vinnipeg / Messenger',
  'chat.headerTitle': 'Broadcast chat',
  'chat.contextKicker': 'Live channel / 01',
  'chat.contextTitle': 'Conversation around the broadcast',
  'chat.contextCopy': 'Comment on what you hear or suggest a topic for the open mic.',
  'chat.presence': '{n} listeners online',
  'chat.emptyTitle': 'The chat is still quiet',
  'chat.emptyCopy': 'Write the first message or suggest a topic for the air.',
  'chat.placeholder': 'Write as {nick}…',
  'chat.inputAria': 'Message to the broadcast chat',
  'chat.send': 'Send',
  'chat.delete': 'Delete',
  'chat.deleted': 'Message deleted',
  'chat.sendError': "Couldn't send the message.",
  'chat.renameError': "Couldn't change the nickname.",
  'chat.typing': '{name} is typing…',
  'chat.typingMulti': '{n} people are typing…',
  'chat.reply': 'Reply',
  'chat.edit': 'Edit',
  'chat.save': 'Save',
  'chat.cancel': 'Cancel',
  'chat.edited': 'edited',
  'chat.editEsc': 'Escape to cancel ·',
  'chat.react': 'Add reaction',
  'chat.unreact': 'Remove reaction',
  'chat.replyingTo': 'Replying to',
  'chat.scrollToBottom': 'Scroll to latest messages',
  // Keyboard shortcuts
  'shortcuts.title': 'Keyboard shortcuts',
  'shortcuts.chat': 'Open / close chat',
  'shortcuts.join': 'Join / leave voice',
  'shortcuts.mic': 'Mute / unmute mic',
  'shortcuts.ptt': 'Push-to-talk (hold)',
  'shortcuts.editLast': 'Edit last message (empty input)',
  'shortcuts.close': 'Close panel',
  'shortcuts.help': 'Show this help',
  // Voice panel
  'voice.inCallYou': "You're in the call · {n} {ppl}",
  'voice.inCall': 'In call · {n} {ppl}',
  'voice.settings': 'Settings',
  'voice.soundSettings': 'Sound settings',
  'voice.liveTitle': 'Live radio conversation',
  'voice.speaking': 'Speaking: {names}',
  'voice.micOn': "Mic on — speak, you're heard",
  'voice.pttHint': 'Hold Space or the button below to talk',
  'voice.listenHint': 'Listening. Tap the mic to say a word',
  'voice.pttLive': 'Speaking live…',
  'voice.pttHold': 'Hold PTT',
  'voice.muteMic': 'Mute microphone',
  'voice.unmuteMic': 'Unmute microphone',
  'voice.leave': 'Leave the call',
  'voice.you': 'you',
  'voice.participants': 'Call participants',
  'voice.inProgress': 'Conversation in progress',
  'voice.join': 'Join the broadcast',
  'voice.connecting': 'Connecting…',
  'voice.silence': 'Silence on air',
  'voice.nobody': 'Nobody is here right now',
  'voice.inviteCopy': 'Join the group conversation — you can listen without a mic and speak only if you want.',
  'voice.start': 'Start a live broadcast',
  'voice.signalLabelLive': 'Live audio signal of the conversation',
  'voice.signalLabelCurrent': 'Audio signal of the current conversation',
  'voice.signalLabelWaiting': 'The air is waiting for the first conversation',
  'voice.audioUnlock': "🔊 Tap to turn on participants' sound",
  'voice.qGood': 'Strong connection',
  'voice.qOk': 'Decent connection',
  'voice.qWeak': 'Weak connection',
  // Settings panel
  'set.title': 'Sound settings',
  'set.close': 'Close',
  'set.volume': 'Listener volume',
  'set.mic': 'Microphone',
  'set.sysDefault': 'System default',
  'set.micFallback': 'Microphone {id}',
  'set.ptt': 'Push-to-talk',
  'set.pttHint': 'Space or button — hold to talk',
}

const uk: Dict = {
  'app.loading': 'Налаштовуємо ефір…',
  'app.connectError': 'Не вдалося підключитися до радіо. Оновіть сторінку.',
  'nav.air': 'Ефір',
  'nav.schedule': 'Розклад',
  'nav.about': 'Про радіо',
  'nav.chat': 'Чат',
  'top.brandEyebrow': 'Munister / Radio 01',
  'top.online': 'Ефір відкрито · {n}',
  'top.changeNick': 'Змінити нік',
  'top.toAir': 'Radio Vinnipeg — до ефіру',
  'hero.kicker': 'Незалежний живий ефір',
  'hero.tagline': 'Відкрите радіо, де слухач може стати голосом ефіру',
  'freq.onair': 'ON AIR',
  'freq.web': 'WEB FREQUENCY',
  'schedule.kicker': 'Ритм станції',
  'schedule.heading': 'Зараз.<br />Далі.',
  'clock.aria': 'Поточний ритм станції',
  'clock.now': 'Зараз / {time}',
  'clock.next': 'Далі / {time}',
  'clock.progress': 'Поточний слот завершено на {pct} відсотків',
  'slot.0.label': 'Нічний відкритий ефір', 'slot.0.note': 'Тиха розмова без заданої теми',
  'slot.1.label': 'Ранковий сигнал', 'slot.1.note': 'Початок дня разом зі слухачами',
  'slot.2.label': 'Денна розмова', 'slot.2.note': 'Вільний мікрофон і живі включення',
  'slot.3.label': 'Вечірній відкритий мікрофон', 'slot.3.note': 'Головний розмовний слот станції',
  'about.kicker': 'Радіо як спільний простір',
  'about.heading': 'Не плейлист.<br />Живі люди.',
  'about.copy': 'Слухайте розмову наживо або долучайтеся з мікрофоном, коли маєте що сказати.',
  'about.accessT': 'Вхід', 'about.accessD': 'без реєстрації',
  'about.formatT': 'Формат', 'about.formatD': 'відкритий мікрофон',
  'about.connT': "Зв'язок", 'about.connD': 'наживо у браузері',
  'chat.launcherKicker': 'Messenger',
  'chat.open': 'Відкрити чат',
  'chat.close': 'Закрити чат',
  'chat.unreadAria': '{n} непрочитаних повідомлень',
  'chat.dockChat': 'Чат',
  'chat.headerKicker': 'Radio Vinnipeg / Messenger',
  'chat.headerTitle': 'Чат ефіру',
  'chat.contextKicker': 'Live channel / 01',
  'chat.contextTitle': 'Розмова навколо ефіру',
  'chat.contextCopy': 'Коментуйте почуте або запропонуйте тему для відкритого мікрофона.',
  'chat.presence': '{n} слухачів онлайн',
  'chat.emptyTitle': 'Чат ще мовчить',
  'chat.emptyCopy': 'Напишіть перше повідомлення або запропонуйте тему для ефіру.',
  'chat.placeholder': 'Напишіть як {nick}…',
  'chat.inputAria': 'Повідомлення в чат ефіру',
  'chat.send': 'Надіслати',
  'chat.delete': 'Видалити',
  'chat.deleted': 'Повідомлення видалено',
  'chat.sendError': 'Не вдалося надіслати повідомлення.',
  'chat.renameError': 'Не вдалося змінити нік.',
  'chat.typing': '{name} друкує…',
  'chat.typingMulti': '{n} людини друкують…',
  'chat.reply': 'Відповісти',
  'chat.edit': 'Редагувати',
  'chat.save': 'Зберегти',
  'chat.cancel': 'Скасувати',
  'chat.edited': 'ред.',
  'chat.editEsc': 'Escape для скасування ·',
  'chat.react': 'Додати реакцію',
  'chat.unreact': 'Прибрати реакцію',
  'chat.replyingTo': 'Відповідь для',
  'chat.scrollToBottom': 'Прокрутити до останніх повідомлень',
  'shortcuts.title': 'Гарячі клавіші',
  'shortcuts.chat': 'Відкрити / закрити чат',
  'shortcuts.join': 'Приєднатися / вийти з розмови',
  'shortcuts.mic': 'Вимкнути / увімкнути мікрофон',
  'shortcuts.ptt': 'Push-to-talk (тримати)',
  'shortcuts.editLast': 'Редагувати останнє своє (поле порожнє)',
  'shortcuts.close': 'Закрити панель',
  'shortcuts.help': 'Показати цю підказку',
  'voice.inCallYou': 'Ви в розмові · {n} {ppl}',
  'voice.inCall': 'У розмові · {n} {ppl}',
  'voice.settings': 'Налаштування',
  'voice.soundSettings': 'Налаштування звуку',
  'voice.liveTitle': 'Радіорозмова наживо',
  'voice.speaking': 'Говорить: {names}',
  'voice.micOn': 'Мікрофон увімкнено — говоріть, вас чують',
  'voice.pttHint': 'Тримайте Space або кнопку нижче щоб говорити',
  'voice.listenHint': 'Слухаєте. Натисніть мікрофон, щоб сказати слово',
  'voice.pttLive': 'Говорите наживо…',
  'voice.pttHold': 'Тримайте PTT',
  'voice.muteMic': 'Вимкнути мікрофон',
  'voice.unmuteMic': 'Увімкнути мікрофон',
  'voice.leave': 'Вийти з розмови',
  'voice.you': 'ви',
  'voice.participants': 'Учасники розмови',
  'voice.inProgress': 'Розмова триває',
  'voice.join': 'Приєднатися до ефіру',
  'voice.connecting': 'Підключення…',
  'voice.silence': 'Тиша в ефірі',
  'voice.nobody': 'Зараз тут нікого немає',
  'voice.inviteCopy': 'Приєднайтесь до групової розмови — слухати можна без мікрофона, говорити лише за бажанням.',
  'voice.start': 'Розпочати живий ефір',
  'voice.signalLabelLive': 'Живий аудіосигнал розмови',
  'voice.signalLabelCurrent': 'Аудіосигнал поточної розмови',
  'voice.signalLabelWaiting': 'Ефір очікує на першу розмову',
  'voice.audioUnlock': '🔊 Натисніть, щоб увімкнути звук співрозмовників',
  'voice.qGood': "Стабільний зв'язок",
  'voice.qOk': "Нормальний зв'язок",
  'voice.qWeak': "Слабкий зв'язок",
  'set.title': 'Налаштування звуку',
  'set.close': 'Закрити',
  'set.volume': 'Гучність слухачів',
  'set.mic': 'Мікрофон',
  'set.sysDefault': 'Системний за замовчуванням',
  'set.micFallback': 'Мікрофон {id}',
  'set.ptt': 'Push-to-talk',
  'set.pttHint': 'Space або кнопка — тримати щоб говорити',
}

const dicts: Record<Lang, Dict> = { en, uk }

export type Translate = (key: string, params?: Record<string, string | number>) => string

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: Translate }

const I18nContext = createContext<Ctx | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitial)

  useEffect(() => {
    document.documentElement.lang = lang
    try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
  }, [lang])

  const value = useMemo<Ctx>(() => {
    const t: Translate = (key, params) => {
      let str = dicts[lang][key] ?? dicts.en[key] ?? key
      if (params) for (const [k, v] of Object.entries(params)) str = str.replaceAll(`{${k}}`, String(v))
      return str
    }
    return { lang, setLang: setLangState, t }
  }, [lang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}

/** Множина «людина/людей» (uk) чи «person/people» (en). */
export function peopleWord(n: number, lang: Lang): string {
  if (lang === 'en') return n === 1 ? 'person' : 'people'
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'людина'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'людини'
  return 'людей'
}
