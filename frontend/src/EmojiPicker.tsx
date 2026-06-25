import { useEffect, useRef, useState } from 'react'

type Props = {
  onPick: (emoji: string) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

const CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: '😀',
    emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🫡','🤔','🫠','🤭','🫢','🫣','🤫','🤥','😶','🫥','😶‍🌫️','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','😵‍💫','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕'],
  },
  {
    label: '👋',
    emojis: ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','🫵','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👀','👁️','👅','👄','🫦'],
  },
  {
    label: '❤️',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✨','💫','⭐','🌟','💥','🔥','🌈','⚡','❄️','🌊','🌸','🌺','🌻','🌹','💐','🌴','🍀','🪷','🌷'],
  },
  {
    label: '🐶',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈'],
  },
  {
    label: '🍕',
    emojis: ['🍕','🍔','🌮','🌯','🥪','🥨','🥯','🍞','🥐','🥖','🫓','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍟','🧆','🥙','🧏','🫔','🥗','🥘','🫕','🍲','🍜','🍝','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🧂','🥤','🧋','☕','🍵','🫖','🍺','🍻','🥂','🍷','🫗','🥃','🍸','🍹','🧃','🥛','🫙'],
  },
  {
    label: '🎮',
    emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🥊','🥋','🎯','⛳','🪁','🎣','🤿','🎽','🎿','🛷','🥌','🎮','🕹️','🎲','♟️','🎭','🎪','🎨','🖼️','🎬','🎤','🎧','🎵','🎶','🎷','🎸','🎹','🎺','🎻','🪕','🥁','🪘','🎙️','📻','📺','📷','📸','🎥','🎞️'],
  },
  {
    label: '🏠',
    emojis: ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','🕹️','🗜️','💾','💿','📀','📼','📷','📸','📹','🎥','📞','☎️','📟','📠','📺','📻','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🪫','🔌','💡','🔦','🕯️','💸','💰','💳','💎','⚖️','🧰','🪛','🔧','🔨','⚒️','🛠️','🪚','🔩','🪝','🧲','🪤','🔫','💣','🪓','🔪','🗡️','⚔️','🛡️','🚪','🪞','🪟','🛏️','🛋️','🪑','🚽','🪠','🚿','🛁','🪤','🧴','🧷','🧹','🧺','🧻','🪣','🧼','🫧','🪥','🧽','🧯','🛒','🚬','⚰️','🪦','⚱️','🧿','💈','⚗️','🔭','🔬','🩺','💊','🩹','🩼','🩻','🩺','🪬','🗿','🪆','🪅','🪩','🎀','🎁','🎗️','🎟️','🎫','🏷️'],
  },
]

export default function EmojiPicker({ onPick, onClose, anchorRef }: Props) {
  const [cat, setCat] = useState(0)
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchorRef])

  const filtered = search.trim()
    ? CATEGORIES.flatMap((c) => c.emojis).filter((e) => e.includes(search))
    : CATEGORIES[cat].emojis

  return (
    <div className="emoji-picker" ref={panelRef}>
      <div className="emoji-search-row">
        <input
          className="emoji-search"
          placeholder="Пошук…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      {!search.trim() && (
        <div className="emoji-cats" role="tablist">
          {CATEGORIES.map((c, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              className={`emoji-cat-btn ${i === cat ? 'active' : ''}`}
              onClick={() => setCat(i)}
            >{c.label}</button>
          ))}
        </div>
      )}
      <div className="emoji-grid">
        {filtered.length === 0 && <span className="emoji-empty">Не знайдено</span>}
        {filtered.map((e, i) => (
          <button
            key={i}
            type="button"
            className="emoji-btn"
            onClick={() => onPick(e)}
            title={e}
          >{e}</button>
        ))}
      </div>
    </div>
  )
}
