import { useCallback, useEffect, useMemo, useState } from 'react'
import { FX_OFF, type FxParams } from './micFx'

function ls(key: string, def: string): string {
  try { return localStorage.getItem(key) ?? def } catch { return def }
}
function lsSet(key: string, val: string) {
  try { localStorage.setItem(key, val) } catch { /* ignore */ }
}

/**
 * Як чути переклад:
 *  text  - тільки текстом, голос мовчить;
 *  mix   - оригінал і голос разом, оригінал приглушується на час фрази;
 *  voice - тільки переклад, оригінал приглушений весь час.
 */
export type TrMode = 'text' | 'mix' | 'voice'

export type Settings = {
  fx: FxParams            // ефекти мікрофона в ефірі
  volume: number          // 0–1, гучність вхідного аудіо
  micDeviceId: string     // deviceId вибраного мікрофона ('' = системний)
  pttMode: boolean        // push-to-talk замість toggle
  devices: MediaDeviceInfo[]
  trMode: TrMode          // як чути переклад
  trVoiceURI: string      // обраний голос синтезу ('' = підібрати самому)
  trRate: number          // швидкість мовлення, 0.8-1.4
  trDuck: number          // гучність кімнати під голосом, 0-1
  trTakeMs: number        // довжина дубля: коротший - швидше, але рваніше
  setTrMode: (m: TrMode) => void
  setTrVoiceURI: (v: string) => void
  setTrRate: (v: number) => void
  setTrDuck: (v: number) => void
  setTrTakeMs: (v: number) => void
  setVolume: (v: number) => void
  setMicDevice: (id: string) => void
  setPttMode: (on: boolean) => void
  setFx: (p: FxParams) => void
  refreshDevices: () => void
}

export function useSettings(): Settings {
  const [volume, setVolumeState] = useState(() => parseFloat(ls('rv_vol', '1')))
  const [micDeviceId, setMicDeviceIdState] = useState(() => ls('rv_mic', ''))
  const [pttMode, setPttModeState] = useState(() => ls('rv_ptt', 'false') === 'true')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [trMode, setTrModeState] = useState<TrMode>(() => {
    const v = ls('rv_tr_mode', 'mix')
    return v === 'text' || v === 'voice' ? v : 'mix'
  })
  const [trVoiceURI, setTrVoiceURIState] = useState(() => ls('rv_tr_voice', ''))
  const [trRate, setTrRateState] = useState(() => {
    const v = parseFloat(ls('rv_tr_rate', '1.05'))
    return Number.isFinite(v) ? Math.min(1.4, Math.max(0.8, v)) : 1.05
  })
  const [trDuck, setTrDuckState] = useState(() => {
    const v = parseFloat(ls('rv_tr_duck', '0.22'))
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.22
  })
  const [trTakeMs, setTrTakeMsState] = useState(() => {
    const v = parseInt(ls('rv_tr_take', '6000'), 10)
    return [4000, 6000, 10000].includes(v) ? v : 6000
  })
  const [fxRaw, setFxRaw] = useState<FxParams>(() => {
    try { return { ...FX_OFF, ...JSON.parse(ls('rv_fx', '{}')) } } catch { return FX_OFF }
  })
  // Стабільна ідентичність: інакше useVoice перечитував би ефекти щорендера.
  const fx = useMemo<FxParams>(
    () => ({ drive: fxRaw.drive, echo: fxRaw.echo, reverb: fxRaw.reverb, radio: fxRaw.radio }),
    [fxRaw.drive, fxRaw.echo, fxRaw.reverb, fxRaw.radio],
  )

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((d) => d.kind === 'audioinput'))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const initialRefresh = window.setTimeout(refreshDevices, 0)
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
    return () => {
      window.clearTimeout(initialRefresh)
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices)
    }
  }, [refreshDevices])

  const setTrMode = useCallback((m: TrMode) => { setTrModeState(m); lsSet('rv_tr_mode', m) }, [])
  const setTrVoiceURI = useCallback((v: string) => { setTrVoiceURIState(v); lsSet('rv_tr_voice', v) }, [])
  const setTrRate = useCallback((v: number) => { setTrRateState(v); lsSet('rv_tr_rate', String(v)) }, [])
  const setTrDuck = useCallback((v: number) => { setTrDuckState(v); lsSet('rv_tr_duck', String(v)) }, [])
  const setTrTakeMs = useCallback((v: number) => { setTrTakeMsState(v); lsSet('rv_tr_take', String(v)) }, [])

  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    lsSet('rv_vol', String(v))
  }, [])

  const setMicDevice = useCallback((id: string) => {
    setMicDeviceIdState(id)
    lsSet('rv_mic', id)
  }, [])

  const setPttMode = useCallback((on: boolean) => {
    setPttModeState(on)
    lsSet('rv_ptt', String(on))
  }, [])

  const setFx = useCallback((p: FxParams) => {
    setFxRaw(p)
    lsSet('rv_fx', JSON.stringify(p))
  }, [])

  return {
    volume, micDeviceId, pttMode, devices, fx,
    trMode, trVoiceURI, trRate, trDuck, trTakeMs,
    setTrMode, setTrVoiceURI, setTrRate, setTrDuck, setTrTakeMs,
    setVolume, setMicDevice, setPttMode, setFx, refreshDevices,
  }
}
