/**
 * Анонс найближчого ефіру.
 *
 * Один запис, заданий константою: це не стрічка, а конкретна дата в
 * сітці станції. Блок живе сам — рахує дні до ефіру, у день ефіру
 * показує «сьогодні в ефірі», а після — зникає, щоб не протухнути.
 *
 * Портрет ведучого — єдине кольорове зображення на сайті: усі решта
 * знімків музейний скін знебарвлює, тож обличчя тут працює акцентом.
 */
import { useEffect, useState } from 'react'
import { useI18n } from './i18n'

// 6 вересня 2026, 21:00 за Вінніпегом (CDT = UTC−5).
const AIR_AT = new Date('2026-09-06T21:00:00-05:00')
const HOST_PHOTO = '/host-munister.jpg'

function icsFile(title: string, description: string): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const end = new Date(AIR_AT.getTime() + 2 * 60 * 60 * 1000)
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Winnipeg Nights//Broadcast//EN',
    'BEGIN:VEVENT',
    `UID:pyrokinesis-2026-09-06@radio.munister.com.ua`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(AIR_AT)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description.replace(/\n/g, ' ')}`,
    'URL:https://radio.munister.com.ua/#air',
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }))
}

export default function Announcement() {
  const { lang, t } = useI18n()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const msLeft = AIR_AT.getTime() - now
  const inWinnipeg = (d: Date | number) =>
    new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Winnipeg' })
  const sameDay = inWinnipeg(now) === inWinnipeg(AIR_AT)
  // Ефір іде дві години; після цього анонс знімається сам.
  if (msLeft < -2 * 60 * 60 * 1000) return null

  const days = Math.ceil(msLeft / (24 * 60 * 60 * 1000))
  const status = msLeft <= 0
    ? t('promo.live')
    : sameDay
      ? t('promo.today')
      : t('promo.inDays', { n: days })

  // Час станційний, не читачів: інакше в Києві анонс показував «7 вересня,
  // 05:00» під підписом «CDT · Winnipeg».
  const locale = lang === 'uk' ? 'uk-UA' : 'en-CA'
  const dateLabel = AIR_AT.toLocaleDateString(locale, {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Winnipeg',
  })
  const timeLabel = AIR_AT.toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Winnipeg',
  })

  return (
    <section className="promo" id="broadcast" aria-labelledby="promo-title">
      <div className="promo-portrait">
        <img src={HOST_PHOTO} alt={t('promo.hostAlt')} width={400} height={400} loading="lazy" />
        <span className={`promo-status${msLeft <= 0 ? ' on' : ''}`}>{status}</span>
      </div>

      <div className="promo-body">
        <span className="promo-eyebrow">{t('promo.kicker')}</span>
        <h2 className="promo-title" id="promo-title">{t('promo.title')}</h2>
        <p className="promo-lead">{t('promo.lead')}</p>

        <dl className="promo-facts">
          <div><dt>{t('promo.dateLabel')}</dt><dd>{dateLabel}</dd></div>
          <div><dt>{t('promo.timeLabel')}</dt><dd>{timeLabel} <small>CDT · Winnipeg</small></dd></div>
          <div><dt>{t('promo.hostLabel')}</dt><dd>{t('promo.host')}</dd></div>
        </dl>

        <div className="promo-actions">
          <a className="promo-btn" href="#air">{t('promo.join')}</a>
          <a
            className="promo-link"
            href={icsFile(t('promo.title'), t('promo.lead'))}
            download="winnipeg-nights-2026-09-06.ics"
          >
            {t('promo.calendar')}
          </a>
        </div>
      </div>
    </section>
  )
}
