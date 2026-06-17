import type { Settings } from './useSettings'
import { useI18n } from './i18n'

type Props = {
  settings: Settings
  onClose: () => void
}

export default function SettingsPanel({ settings, onClose }: Props) {
  const { t } = useI18n()
  const { volume, micDeviceId, pttMode, devices, setVolume, setMicDevice, setPttMode, refreshDevices } = settings

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <span>{t('set.title')}</span>
        <button className="settings-close" onClick={onClose} aria-label={t('set.close')}>×</button>
      </div>

      <label className="settings-row">
        <span className="settings-label">{t('set.volume')}</span>
        <div className="settings-volume">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
          />
          <span className="settings-vol-val">{Math.round(volume * 100)}%</span>
        </div>
      </label>

      <label className="settings-row">
        <span className="settings-label">{t('set.mic')}</span>
        <div className="settings-select-wrap">
          <select
            value={micDeviceId}
            onChange={(e) => setMicDevice(e.target.value)}
            onFocus={refreshDevices}
            className="settings-select"
          >
            <option value="">{t('set.sysDefault')}</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t('set.micFallback', { id: d.deviceId.slice(0, 8) })}
              </option>
            ))}
          </select>
        </div>
      </label>

      <label className="settings-row settings-toggle-row">
        <span className="settings-label">
          {t('set.ptt')}
          <span className="settings-hint">{t('set.pttHint')}</span>
        </span>
        <button
          className={`toggle-btn ${pttMode ? 'on' : ''}`}
          onClick={() => setPttMode(!pttMode)}
          aria-pressed={pttMode}
        >
          <span className="toggle-knob" />
        </button>
      </label>
    </div>
  )
}
