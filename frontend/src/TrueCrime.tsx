/**
 * Секція «American True Crime» — стрічка, що оновлюється сама.
 *
 * Бекенд раз на 30 хв тягне публічні RSS (Court TV, Law&Crime — відео;
 * Dateline NBC, 48 Hours, Crime Junkie — аудіо) і віддає їх через
 * /api/truecrime. Фронт перепитує ендпоінт кожні 5 хв і коли вкладка
 * знову стає видимою, тож стрічка свіжа без перезавантаження сторінки.
 *
 * Медіа не хостимо: відео грає з YouTube (iframe вставляємо лише після
 * кліку — інакше на сторінці висіли б десятки плеєрів), аудіо тягнеться
 * прямо з CDN видавця одним спільним <audio>.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchTrueCrime, type CrimeItem } from './api'
import { useI18n } from './i18n'

const REFRESH_MS = 5 * 60 * 1000

type Filter = 'all' | 'video' | 'audio'

function timeAgo(epoch: number, lang: string): string {
  if (!epoch) return ''
  const mins = Math.max(0, Math.round((Date.now() / 1000 - epoch) / 60))
  const uk = lang === 'uk'
  if (mins < 60) return uk ? `${mins} хв тому` : `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return uk ? `${hours} год тому` : `${hours} h ago`
  const days = Math.round(hours / 24)
  return uk ? `${days} дн тому` : `${days} d ago`
}

function formatDate(epoch: number, lang: string): string {
  if (!epoch) return ''
  return new Date(epoch * 1000).toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-US', {
    day: 'numeric', month: 'short',
  })
}

export default function TrueCrime() {
  const { lang, t } = useI18n()
  const [items, setItems] = useState<CrimeItem[]>([])
  const [updatedAt, setUpdatedAt] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [openVideo, setOpenVideo] = useState<string | null>(null)
  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const load = useCallback(async () => {
    try {
      const feed = await fetchTrueCrime(40)
      setItems(feed.items)
      setUpdatedAt(feed.updated_at)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // Один спільний плеєр на всю секцію: другий трек зупиняє перший.
  useEffect(() => () => { audioRef.current?.pause() }, [])

  const toggleAudio = (item: CrimeItem) => {
    if (!item.media_url) return
    const el = audioRef.current ?? new Audio()
    audioRef.current = el
    if (playingAudio === item.guid) {
      el.pause()
      setPlayingAudio(null)
      return
    }
    el.pause()
    el.src = item.media_url
    el.play().then(() => setPlayingAudio(item.guid)).catch(() => setPlayingAudio(null))
    el.onended = () => setPlayingAudio(null)
  }

  const shown = items.filter((i) => filter === 'all' || i.media_kind === filter)

  return (
    <section className="tc-root" id="cases">
      <header className="tc-head">
        <div>
          <span className="tc-eyebrow">{t('crime.kicker')}</span>
          <h2 className="tc-title">{t('crime.heading')}</h2>
          <p className="tc-sub">{t('crime.sub')}</p>
        </div>
        <div className="tc-meta">
          <div className="tc-filters" role="tablist" aria-label={t('crime.heading')}>
            {(['all', 'video', 'audio'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                className={`tc-filter${filter === f ? ' on' : ''}`}
                onClick={() => setFilter(f)}
              >
                {t(`crime.filter.${f}`)}
              </button>
            ))}
          </div>
          <span className="tc-updated">
            {updatedAt
              ? t('crime.updated', { when: timeAgo(updatedAt, lang) })
              : t('crime.updating')}
          </span>
        </div>
      </header>

      {shown.length === 0 ? (
        <p className="tc-empty">{failed ? t('crime.failed') : t('crime.updating')}</p>
      ) : (
        <ol className="tc-grid">
          {shown.map((item) => {
            const isOpen = openVideo === item.guid
            const isPlaying = playingAudio === item.guid
            return (
              <li key={item.guid} className={`tc-card${isPlaying ? ' playing' : ''}`}>
                <div className="tc-shot">
                  {isOpen && item.video_id ? (
                    <iframe
                      className="tc-frame"
                      src={`https://www.youtube-nocookie.com/embed/${item.video_id}?autoplay=1&rel=0`}
                      title={item.title}
                      allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                    />
                  ) : (
                    <button
                      type="button"
                      className="tc-shot-btn"
                      onClick={() => item.media_kind === 'video'
                        ? setOpenVideo(item.guid)
                        : toggleAudio(item)}
                      aria-label={`${item.media_kind === 'video' ? t('crime.play') : t('crime.listen')}: ${item.title}`}
                    >
                      {item.image && (
                        <img src={item.image} alt="" loading="lazy" decoding="async" />
                      )}
                      <span className="tc-shot-cue" aria-hidden>
                        {item.media_kind === 'video' ? '▶' : isPlaying ? '❚❚' : '▶'}
                      </span>
                    </button>
                  )}
                </div>

                <div className="tc-body">
                  <span className="tc-line">
                    <span className="tc-source">{item.source}</span>
                    <span className="tc-dot" aria-hidden>·</span>
                    <span className="tc-kind">{t(`crime.kind.${item.media_kind}`)}</span>
                    {item.duration && <span className="tc-dur">{item.duration}</span>}
                    <time className="tc-date">{formatDate(item.published_at, lang)}</time>
                  </span>
                  <h3 className="tc-name">{item.title}</h3>
                  {item.summary && <p className="tc-sum">{item.summary}</p>}
                  <span className="tc-actions">
                    <button
                      type="button"
                      className="tc-btn"
                      onClick={() => item.media_kind === 'video'
                        ? setOpenVideo(isOpen ? null : item.guid)
                        : toggleAudio(item)}
                    >
                      {item.media_kind === 'video'
                        ? (isOpen ? t('crime.close') : t('crime.play'))
                        : (isPlaying ? t('crime.pause') : t('crime.listen'))}
                    </button>
                    {item.link && (
                      <a className="tc-link" href={item.link} target="_blank" rel="noopener noreferrer">
                        {t('crime.source')} ↗
                      </a>
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <p className="tc-credit">{t('crime.credit')}</p>
    </section>
  )
}
