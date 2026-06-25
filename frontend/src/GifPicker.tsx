import { useEffect, useRef, useState } from 'react'

type GifResult = {
  id: string
  url: string   // tinygif URL for preview + sending
  preview: string // nanogif or tinygif for grid preview
}

const TENOR_KEY = 'LIVDSRZULELA'

async function fetchTenor(endpoint: string): Promise<GifResult[]> {
  const res = await fetch(
    `https://api.tenor.com/v1/${endpoint}&key=${TENOR_KEY}&limit=16&media_filter=minimal`,
  )
  if (!res.ok) return []
  const json = await res.json()
  return (json.results ?? []).map((r: any) => {
    const m = r.media?.[0] ?? {}
    return {
      id: r.id,
      url: (m.tinygif?.url ?? m.gif?.url ?? '') as string,
      preview: (m.nanogif?.url ?? m.tinygif?.url ?? m.gif?.url ?? '') as string,
    }
  }).filter((r: GifResult) => r.url)
}

type Props = {
  onPick: (gifUrl: string) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

export default function GifPicker({ onPick, onClose, anchorRef }: Props) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<GifResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetchTenor('trending?')
      .then(setGifs)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!query.trim()) {
      setLoading(true)
      fetchTenor('trending?')
        .then(setGifs)
        .catch(() => setError(true))
        .finally(() => setLoading(false))
      return
    }
    timerRef.current = setTimeout(() => {
      setLoading(true)
      setError(false)
      fetchTenor(`search?q=${encodeURIComponent(query.trim())}`)
        .then(setGifs)
        .catch(() => setError(true))
        .finally(() => setLoading(false))
    }, 420)
  }, [query])

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

  return (
    <div className="gif-picker" ref={panelRef}>
      <div className="gif-search-row">
        <input
          className="gif-search"
          placeholder="Пошук GIF…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <span className="gif-powered">via Tenor</span>
      </div>
      <div className="gif-grid">
        {loading && <div className="gif-loading"><span /><span /><span /></div>}
        {!loading && error && <p className="gif-error">Не вдалося завантажити GIF</p>}
        {!loading && !error && gifs.length === 0 && <p className="gif-error">Нічого не знайдено</p>}
        {!loading && gifs.map((g) => (
          <button
            key={g.id}
            type="button"
            className="gif-thumb"
            onClick={() => onPick(g.url)}
          >
            <img src={g.preview} alt="gif" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  )
}
