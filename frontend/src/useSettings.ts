import { useCallback, useEffect, useMemo, useState } from 'react'
import { FX_OFF, type FxParams } from './micFx'

function ls(key: string, def: string): string {
  try { return localStorage.getItem(key) ?? def } catch { return def }
}
function lsSet(key: string, val: string) {
  try { localStorage.setItem(key, val) } catch { /* ignore */ }
}

export type Settings = {
  fx: FxParams            // ефекти мікрофона в ефірі
  volume: number          // 0–1, гучність вхідного аудіо
  micDeviceId: string     // deviceId вибраного мікрофона ('' = системний)
  pttMode: boolean        // push-to-talk замість toggle
  devices: MediaDeviceInfo[]
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

  return { volume, micDeviceId, pttMode, devices, fx, setVolume, setMicDevice, setPttMode, setFx, refreshDevices }
}
