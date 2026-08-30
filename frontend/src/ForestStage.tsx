import { useEffect, useRef, useState } from 'react'
import type { User, NowPlaying } from './api'
import { getNowPlaying, setNowPlaying } from './api'
import SettingsPanel from './SettingsPanel'
import { useSettings } from './useSettings'
import { useVoice } from './useVoice'
import type { VoiceStats } from './VoicePanel'
import { useI18n, peopleWord } from './i18n'
import { useTranslation } from './useTranslation'
import { useSpeech } from './useSpeech'
import { fetchTranslationHealth } from './api'
import { useYouTubePlayer } from './useYouTubePlayer'
import { FX_PRESETS, fxIsActive, type FxParams } from './micFx'
import './forest.css'

const FX_KNOBS: { key: keyof FxParams; label: string }[] = [
  { key: 'drive',  label: 'Drive' },
  { key: 'echo',   label: 'Echo' },
  { key: 'reverb', label: 'Reverb' },
  { key: 'radio',  label: 'Radio' },
]

function fxSame(a: FxParams, b: FxParams): boolean {
  return FX_KNOBS.every(({ key }) => Math.abs(a[key] - b[key]) < 0.001)
}


function PlayGlyph() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.4l12 6.6-12 6.6V5.4Z" /></svg>
}
function SpeakGlyph({ muted }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden width="14" height="14">
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4v-5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      {muted
        ? <path d="m16 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        : <path d="M15.8 9c1.1.9 1.1 5.1 0 6M18.6 6.7c2.2 2 2.2 8.6 0 10.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
    </svg>
  )
}

function TranslateGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden width="16" height="16">
      <path d="M3 5.5h8M7 4v1.5M9.2 5.5c0 3.2-2.3 5.9-5.2 7M5.4 8.6c.9 2 2.6 3.5 4.8 4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m12.6 20 3.9-9.4L20.4 20M13.9 17.1h5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MicGlyph({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 4.5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0v-6Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {off && <path d="M3.5 3.5l17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  )
}
function VolGlyph({ muted }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M11 5L6 9H3v6h3l5 4V5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      {!muted && <path d="M15.5 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
      {muted && <path d="M19 9l-6 6M13 9l6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
    </svg>
  )
}
function GearGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

export default function ForestStage({ user, onStats, room = 'lounge' }: { user: User; onStats?: (s: VoiceStats) => void; room?: string }) {
  const { t, lang } = useI18n()
  const settings = useSettings()
  const { members, joined, micOn, connecting, error, speaking, quality, connStats, audioBlocked, unlockAudio, join, leave, toggleMic, getTranslationStream, duckRemote } =
    useVoice(user.id, { volume: settings.volume, micDeviceId: settings.micDeviceId, room, fx: settings.fx })

  // Переклад ефіру англійською. Кнопка з'являється, тільки якщо бекенд
  // відповідає, що модель піднята: без неї вмикати нічого.
  const [trAvailable, setTrAvailable] = useState(false)
  const [trOn, setTrOn] = useState(false)
  useEffect(() => {
    let alive = true
    fetchTranslationHealth()
      .then((h) => { if (alive) setTrAvailable(!!h.enabled) })
      .catch(() => { if (alive) setTrAvailable(false) })
    return () => { alive = false }
  }, [])
  const translation = useTranslation(getTranslationStream, trOn && joined, settings.trTakeMs)
  useEffect(() => { if (!joined) setTrOn(false) }, [joined])

  // Озвучення перекладу. Синтез робить браузер, тож це справа кожного слухача
  // окремо: хтось слухає голосом, хтось читає текстом.
  const [cfgOpen, setCfgOpen] = useState(false)
  const ttsOn = settings.trMode !== 'text'
  // Беремо say окремо: сам об'єкт хука створюється щоразу заново, і ефект
  // нижче перезапускався б на кожен рендер.
  const speech = useSpeech(ttsOn && trOn && joined, {
    voiceURI: settings.trVoiceURI,
    rate: settings.trRate,
    // У режимі «тільки переклад» кімната приглушена весь час, тож на фразу
    // нічого перемикати не треба - інакше гучність смикалася б туди-сюди.
    onSpeakingChange: settings.trMode === 'mix'
      ? (sp) => duckRemote(sp ? settings.trDuck : 1)
      : undefined,
  })
  const { say } = speech
  // Режим «тільки переклад»: оригінал притишений, поки переклад увімкнений.
  useEffect(() => {
    if (!(trOn && joined)) { duckRemote(1); return }
    if (settings.trMode === 'voice') duckRemote(settings.trDuck)
    else if (settings.trMode === 'text') duckRemote(1)
    return () => duckRemote(1)
  }, [trOn, joined, settings.trMode, settings.trDuck, duckRemote])
  // Озвучуємо тільки нові рядки, і тільки якщо озвучення увімкнули ДО них:
  // інакше при вмиканні кнопки хором пішла б уся стрічка з початку розмови.
  const spokenRef = useRef<number>(0)
  useEffect(() => {
    if (!ttsOn) { spokenRef.current = translation.lines.length ? translation.lines[translation.lines.length - 1].id : 0; return }
    for (const line of translation.lines) {
      if (line.id <= spokenRef.current) continue
      spokenRef.current = line.id
      say(line.text)
    }
  }, [ttsOn, translation.lines, say])

  // Now Playing
  const [np, setNp] = useState<NowPlaying>(null)
  // Плеєр живе поза циклом опитування: хук синкує його командами, а не новим src.
  const ytHost = useYouTubePlayer(np)
  const [npInput, setNpInput] = useState('')
  const [npOpen, setNpOpen] = useState(false)
  const npRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setNp(null)
    setNpInput('')
    const load = () => getNowPlaying(room).then(setNp).catch(() => {})
    load()
    const t = window.setInterval(load, 4000)
    return () => { window.clearInterval(t); if (npRef.current) clearTimeout(npRef.current) }
  }, [room])

  const onStatsRef = useRef(onStats)
  useEffect(() => { onStatsRef.current = onStats })
  useEffect(() => {
    if (!joined || !quality) { onStatsRef.current?.(null); return }
    onStatsRef.current?.({ quality, rttMs: connStats.rttMs, lossPercent: connStats.lossPercent })
  }, [joined, quality, connStats.rttMs, connStats.lossPercent])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pttHeld, setPttHeld] = useState(false)
  const pttBusyRef = useRef(false)
  // Якщо користувач явно вийшов — не авто-підключаємось знову.
  const explicitLeaveRef = useRef(false)
  // Пасивний слухач: підключились автоматично, мік вимкнено.
  const [passive, setPassive] = useState(false)

  const total = members.length + (joined ? 1 : 0)
  const speakers = members.filter((m) => m.speaking)
  const someoneSpeaking = speakers.length > 0 || (joined && micOn && speaking)
  const active = joined || members.length > 0

  // Авто-підключення як тихий слухач, коли хтось у кімнаті.
  // Слухач отримує аудіо через WebRTC без кліку — «увімкнулось радіо».
  const joinRef = useRef(join)
  useEffect(() => { joinRef.current = join }, [join])
  useEffect(() => {
    if (joined || connecting || members.length === 0 || explicitLeaveRef.current) return
    setPassive(true)
    joinRef.current()
  }, [joined, connecting, members.length])

  // Schedule slots (mirror RadioPage) → drives the tile rail + channel 2
  const SLOT_STARTS = [0, 8, 12, 18]
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const id = window.setInterval(() => setHour(new Date().getHours()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const activeSlot = SLOT_STARTS.reduce((acc, s, i) => (hour >= s ? i : acc), 0)
  const nextSlot = (activeSlot + 1) % SLOT_STARTS.length
  const pad2 = (n: number) => String(n % 24).padStart(2, '0')

  // PTT (Space) у режимі рації
  useEffect(() => {
    if (!joined || !settings.pttMode) return
    const dn = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      if (!pttBusyRef.current && !micOn) {
        pttBusyRef.current = true; setPttHeld(true)
        toggleMic().finally(() => { pttBusyRef.current = false })
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (pttHeld && micOn) { setPttHeld(false); toggleMic() }
    }
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
  }, [joined, settings.pttMode, micOn, pttHeld, toggleMic])


  return (
    <section className="fx-stage" id="air">
      {/* ════ Two-column grid: featured cell + tile rail ════ */}
      <div className="fx-grid">
        {/* ── Featured live cell (the "artwork") ── */}
        <div className="fx-feature">

          <div className="fx-deck">
            {!joined ? (
              <div className="fx-deck-idle">
                <button
                  className="fx-play"
                  onClick={join}
                  disabled={connecting}
                  aria-label={members.length ? t('voice.join') : t('voice.start')}
                >
                  <span className={`fx-play-ring r1 ${active ? 'on' : ''}`} aria-hidden />
                  <span className={`fx-play-ring r2 ${active ? 'on' : ''}`} aria-hidden />
                  <span className={`fx-play-ring r3 ${active ? 'on' : ''}`} aria-hidden />
                  <PlayGlyph />
                </button>
                <div className="fx-deck-text">
                  <span className="fx-deck-kicker">
                    {connecting ? t('voice.connecting') : members.length ? t('voice.join') : 'Winnipeg Nights'}
                  </span>
                  <h1 className="fx-deck-title">Winnipeg Nights</h1>
                  <p className="fx-deck-desc">{t('hero.tagline')}</p>
                </div>
              </div>
            ) : (
              <div className="fx-deck-live">
                <div className="fx-deck-livehead">
                  <span className="fx-deck-live-title">
                    {passive ? '🔊 Listening' : 'Winnipeg Nights'}
                  </span>
                  <span className="fx-deck-live-status">
                    {passive
                      ? `${total} ${peopleWord(total, lang)} on air`
                      : t('voice.inCallYou', { n: total, ppl: peopleWord(total, lang) })}
                  </span>
                  <button className="fx-gear" onClick={() => setSettingsOpen((v) => !v)} aria-label={t('voice.soundSettings')}>
                    <GearGlyph />
                  </button>
                </div>

                <div className={`fx-wave ${someoneSpeaking ? 'live' : ''}`} aria-hidden>
                  {Array.from({ length: 40 }).map((_, i) => (
                    <i key={i} style={{ animationDelay: `${i * 0.04}s` }} />
                  ))}
                </div>

                {audioBlocked && (
                  <button className="fx-unlock" onClick={unlockAudio}>{t('voice.audioUnlock')}</button>
                )}

                <div className="fx-vol">
                  <span className="fx-vol-ic"><VolGlyph muted={settings.volume === 0} /></span>
                  <input type="range" min="0" max="1" step="0.02" value={settings.volume}
                    onChange={(e) => settings.setVolume(parseFloat(e.target.value))} aria-label={t('set.volume')} />
                  <span className="fx-vol-val">{Math.round(settings.volume * 100)}%</span>
                </div>

                {/* ── Ефекти мікрофона ── */}
                <div className={`fx-rack ${fxIsActive(settings.fx) ? 'on' : ''}`}>
                  <div className="fx-rack-head">
                    <span className="fx-rack-label">FX</span>
                    <div className="fx-rack-presets">
                      {FX_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          className={`fx-preset ${fxSame(settings.fx, preset.params) ? 'on' : ''}`}
                          onClick={() => settings.setFx(preset.params)}
                        >{preset.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="fx-knobs">
                    {FX_KNOBS.map(({ key, label }) => (
                      <label key={key} className="fx-knob">
                        <span className="fx-knob-name">{label}</span>
                        <input
                          type="range" min="0" max="1" step="0.05"
                          value={settings.fx[key]}
                          onChange={(e) => settings.setFx({ ...settings.fx, [key]: parseFloat(e.target.value) })}
                        />
                        <span className="fx-knob-val">{Math.round(settings.fx[key] * 100)}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="fx-controls">
                  {passive ? (
                    /* Пасивний слухач — кнопка «Вийти в ефір» */
                    <button className="fx-mic" onClick={() => { setPassive(false); toggleMic() }}>
                      <MicGlyph />{t('voice.start')}
                    </button>
                  ) : settings.pttMode ? (
                    <button
                      className={`fx-mic ${pttHeld ? 'live' : ''}`}
                      onMouseDown={() => { if (!micOn && !pttBusyRef.current) { pttBusyRef.current = true; setPttHeld(true); toggleMic().finally(() => { pttBusyRef.current = false }) } }}
                      onMouseUp={() => { if (micOn) { setPttHeld(false); toggleMic() } }}
                      onMouseLeave={() => { if (micOn) { setPttHeld(false); toggleMic() } }}
                      onTouchStart={(e) => { e.preventDefault(); if (!micOn && !pttBusyRef.current) { pttBusyRef.current = true; setPttHeld(true); toggleMic().finally(() => { pttBusyRef.current = false }) } }}
                      onTouchEnd={() => { if (micOn) { setPttHeld(false); toggleMic() } }}
                    >
                      <MicGlyph off={!pttHeld} />{pttHeld ? t('voice.pttLive') : t('voice.pttHold')}
                    </button>
                  ) : (
                    <button className={`fx-mic ${micOn ? 'live' : ''}`} onClick={toggleMic}>
                      <MicGlyph off={!micOn} />{micOn ? t('voice.muteMic') : t('voice.unmuteMic')}
                    </button>
                  )}
                  {trAvailable && (
                    <button
                      className={`fx-tr ${trOn ? 'live' : ''}`}
                      onClick={() => setTrOn(v => !v)}
                      aria-pressed={trOn}
                      aria-label={trOn ? t('tr.toggleOn') : t('tr.toggleOff')}
                    >
                      <TranslateGlyph />{trOn ? 'EN ON' : 'EN'}
                    </button>
                  )}
                  <button className="fx-leave" onClick={() => {
                    explicitLeaveRef.current = true
                    setPassive(false)
                    leave()
                  }}>{passive ? '✕ Stop' : t('voice.leave')}</button>
                </div>

                {trOn && (
                  <div className="fx-translate" aria-live="polite">
                    <div className="fx-translate-top">
                      <span className="fx-translate-title">{t('tr.title')}</span>
                      <span className={`fx-translate-dot ${translation.busy ? 'on' : ''}`} aria-hidden />
                      {speech.available && (
                        <button
                          className={`fx-translate-tts ${ttsOn ? 'on' : ''}`}
                          onClick={() => settings.setTrMode(ttsOn ? 'text' : 'mix')}
                          aria-pressed={ttsOn}
                          title={ttsOn ? t('tr.voiceOn') : t('tr.voiceOff')}
                        >
                          <SpeakGlyph muted={!ttsOn} />{ttsOn ? t('tr.voiceOn') : t('tr.voiceOff')}
                        </button>
                      )}
                      <button
                        className={`fx-translate-cfg-btn ${cfgOpen ? 'on' : ''}`}
                        onClick={() => setCfgOpen(v => !v)}
                        aria-expanded={cfgOpen}
                        title={t('tr.settings')}
                      >{t('tr.settings')}</button>
                      {translation.lines.length > 0 && (
                        <button className="fx-translate-clear" onClick={translation.clear}>{t('tr.clear')}</button>
                      )}
                    </div>
                    {cfgOpen && (
                      <div className="fx-translate-cfg">
                        <div className="fx-cfg-row">
                          <span className="fx-cfg-label">{t('tr.cfgSound')}</span>
                          <div className="fx-cfg-seg">
                            {([['text', t('tr.modeText')], ['mix', t('tr.modeMix')], ['voice', t('tr.modeVoice')]] as const).map(([m, label]) => (
                              <button
                                key={m}
                                className={settings.trMode === m ? 'on' : ''}
                                onClick={() => settings.setTrMode(m)}
                                aria-pressed={settings.trMode === m}
                                disabled={m !== 'text' && !speech.available}
                              >{label}</button>
                            ))}
                          </div>
                        </div>

                        {settings.trMode !== 'text' && speech.voices.length > 1 && (
                          <div className="fx-cfg-row">
                            <span className="fx-cfg-label">{t('tr.cfgVoice')}</span>
                            <select
                              className="fx-cfg-select"
                              value={settings.trVoiceURI}
                              onChange={(e) => settings.setTrVoiceURI(e.target.value)}
                            >
                              <option value="">{t('tr.voiceAuto')}</option>
                              {speech.voices.map(v => (
                                <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {settings.trMode !== 'text' && (
                          <div className="fx-cfg-row">
                            <span className="fx-cfg-label">{t('tr.cfgRate')}</span>
                            <input
                              className="fx-cfg-range" type="range" min={0.8} max={1.4} step={0.05}
                              value={settings.trRate}
                              onChange={(e) => settings.setTrRate(parseFloat(e.target.value))}
                            />
                            <span className="fx-cfg-val">{settings.trRate.toFixed(2)}×</span>
                          </div>
                        )}

                        {settings.trMode !== 'text' && (
                          <div className="fx-cfg-row">
                            <span className="fx-cfg-label">
                              {settings.trMode === 'voice' ? t('tr.cfgRoomAlways') : t('tr.cfgRoomWhile')}
                            </span>
                            <input
                              className="fx-cfg-range" type="range" min={0} max={1} step={0.02}
                              value={settings.trDuck}
                              onChange={(e) => settings.setTrDuck(parseFloat(e.target.value))}
                            />
                            <span className="fx-cfg-val">{Math.round(settings.trDuck * 100)}%</span>
                          </div>
                        )}

                        <div className="fx-cfg-row">
                          <span className="fx-cfg-label">{t('tr.cfgTake')}</span>
                          <div className="fx-cfg-seg">
                            {[4000, 6000, 10000].map(ms => (
                              <button
                                key={ms}
                                className={settings.trTakeMs === ms ? 'on' : ''}
                                onClick={() => settings.setTrTakeMs(ms)}
                                aria-pressed={settings.trTakeMs === ms}
                              >{ms / 1000}s</button>
                            ))}
                          </div>
                        </div>
                        <p className="fx-cfg-note">{t('tr.cfgTakeNote')}</p>
                      </div>
                    )}

                    {translation.error ? (
                      <p className="fx-translate-empty">{translation.error}</p>
                    ) : translation.lines.length === 0 ? (
                      <p className="fx-translate-empty">{translation.busy ? t('tr.listening') : t('tr.waiting')}</p>
                    ) : (
                      <ol className="fx-translate-lines">
                        {translation.lines.map(l => <li key={l.id}>{l.text}</li>)}
                      </ol>
                    )}
                    <p className="fx-translate-hint">
                      {t('tr.hint')}
                      {ttsOn && micOn ? ' ' + t('tr.echoWarn') : ''}
                    </p>
                  </div>
                )}

                <div className="fx-parts" aria-label={t('voice.participants')}>
                  <span className={`fx-part me ${micOn ? 'mic' : ''} ${speaking && micOn ? 'speaking' : ''}`}>
                    <i style={{ background: user.color }} />{t('voice.you')}
                  </span>
                  {members.map((m) => (
                    <span key={m.user_id} className={`fx-part ${m.mic_on ? 'mic' : ''} ${m.speaking ? 'speaking' : ''}`}>
                      <i style={{ background: m.color }} />{m.nickname}
                    </span>
                  ))}
                </div>

                {error && <p className="fx-error">{error}</p>}
                {settingsOpen && <SettingsPanel settings={settings} onClose={() => setSettingsOpen(false)} />}
              </div>
            )}

            {/* ── YouTube Now Playing ── */}
            {(np?.video_id || joined) && (
              <div className="fx-np">
                {np?.video_id ? (
                  <>
                    <div className="fx-np-info">
                      <span className="fx-np-label">▶ {np.is_playing ? 'PLAYING' : 'PAUSED'}</span>
                      <span className="fx-np-title">{np.title || np.video_id}</span>
                      <button className="fx-np-stop" onClick={() => setNowPlaying(room, { video_id: '' }).then(setNp).catch(() => {})} title="Stop">✕</button>
                    </div>
                    <div className="fx-yt">
                      <div ref={ytHost} />
                    </div>
                  </>
                ) : (
                  <button className="fx-np-add" onClick={() => setNpOpen((v) => !v)}>
                    {npOpen ? 'Cancel' : '+ YouTube'}
                  </button>
                )}
                {npOpen && (
                  <form className="fx-np-form" onSubmit={async (e) => {
                    e.preventDefault()
                    if (!npInput.trim()) return
                    const res = await setNowPlaying(room, { video_id: npInput.trim(), is_playing: true, position_sec: 0 }).catch(() => null)
                    if (res) { setNp(res); setNpOpen(false); setNpInput('') }
                  }}>
                    <input className="fx-np-input" value={npInput} onChange={(e) => setNpInput(e.target.value)} placeholder="YouTube link or video ID" autoFocus />
                    <button type="submit" disabled={!npInput.trim()}>Play</button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Tile rail: schedule slots as NTS show-tiles ── */}
        <aside className="fx-rail" aria-label={t('nav.schedule')}>
          <a className="fx-rail-head" href="#schedule">
            <span>{t('schedule.kicker')}</span>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 4v15M6 13l6 6 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </a>
          <div className="fx-tiles">
            {SLOT_STARTS.map((startH, i) => (
              <a key={startH} href="#schedule" className={`fx-tile s${i} ${i === activeSlot ? 'on' : ''}`}>
                <span className="fx-tile-top">
                  <span className="fx-tile-time">{pad2(startH)}:00</span>
                  {i === activeSlot
                    ? <span className="fx-tile-badge">On now</span>
                    : i === nextSlot
                      ? <span className="fx-tile-badge next">Next</span>
                      : null}
                </span>
                <span className="fx-tile-play" aria-hidden><PlayGlyph /></span>
                <span className="fx-tile-name">{t(`slot.${i}.label`)}</span>
              </a>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}
