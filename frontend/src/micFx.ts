/*
  Ефекти мікрофона для ефіру.

  Мікрофонний трек іде не напряму в WebRTC, а через Web Audio:
    mic → drive (waveshaper) → тон (highpass+lowpass) ─┬─→ сухий
                                                       ├─→ delay+feedback (ехо)
                                                       └─→ convolver (реверб)
  Сума йде в MediaStreamDestination, і саме його трек віддається пірам.
  Ланцюг існує завжди, навіть коли всі ручки на нулі, — тому вмикання ефекту
  не потребує replaceTrack і renegotiation, звук не переривається.
*/

export type FxParams = {
  drive: number   // 0..1 — перевантаження, «гітарний» хрип
  echo: number    // 0..1 — рівень повторів
  reverb: number  // 0..1 — хвіст залу
  radio: number   // 0..1 — вузька смуга, звук рації
}

export const FX_OFF: FxParams = { drive: 0, echo: 0, reverb: 0, radio: 0 }

export const FX_PRESETS: { id: string; label: string; params: FxParams }[] = [
  { id: 'dry',     label: 'Dry',     params: FX_OFF },
  { id: 'hall',    label: 'Hall',    params: { drive: 0,    echo: 0.15, reverb: 0.55, radio: 0 } },
  { id: 'cave',    label: 'Cave',    params: { drive: 0,    echo: 0.45, reverb: 0.8,  radio: 0 } },
  { id: 'am',      label: 'AM 94.7', params: { drive: 0.25, echo: 0,    reverb: 0.1,  radio: 0.9 } },
  { id: 'crunch',  label: 'Crunch',  params: { drive: 0.7,  echo: 0.1,  reverb: 0.2,  radio: 0.35 } },
]

export function fxIsActive(p: FxParams): boolean {
  return p.drive > 0.01 || p.echo > 0.01 || p.reverb > 0.01 || p.radio > 0.01
}

/* Симетрична крива перевантаження; amount 0 дає майже лінійний прохід. */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = amount * 100
  const n = 1024
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x))
  }
  return curve
}

/* Імпульсна характеристика генерується кодом: шум з експоненційним спадом. */
function makeImpulse(ctx: AudioContext, seconds = 2.2, decay = 3): AudioBuffer {
  const rate = ctx.sampleRate
  const len = Math.max(1, Math.floor(rate * seconds))
  const buf = ctx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

export class MicFx {
  readonly stream: MediaStream
  private ctx: AudioContext
  private src: MediaStreamAudioSourceNode
  private shaper: WaveShaperNode
  private hp: BiquadFilterNode
  private lp: BiquadFilterNode
  private dry: GainNode
  private delay: DelayNode
  private feedback: GainNode
  private echoGain: GainNode
  private convolver: ConvolverNode
  private reverbGain: GainNode
  private out: GainNode
  private dest: MediaStreamAudioDestinationNode
  private disposed = false

  constructor(ctx: AudioContext, input: MediaStream) {
    this.ctx = ctx
    this.src = ctx.createMediaStreamSource(input)

    this.shaper = ctx.createWaveShaper()
    this.shaper.curve = driveCurve(0)
    this.shaper.oversample = '2x'

    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 20
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass';  this.lp.frequency.value = 20000

    this.dry = ctx.createGain(); this.dry.gain.value = 1

    this.delay = ctx.createDelay(1.5); this.delay.delayTime.value = 0.26
    this.feedback = ctx.createGain(); this.feedback.gain.value = 0
    this.echoGain = ctx.createGain(); this.echoGain.gain.value = 0

    this.convolver = ctx.createConvolver()
    this.convolver.buffer = makeImpulse(ctx)
    this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0

    this.out = ctx.createGain(); this.out.gain.value = 1
    this.dest = ctx.createMediaStreamDestination()

    this.src.connect(this.shaper)
    this.shaper.connect(this.hp)
    this.hp.connect(this.lp)

    this.lp.connect(this.dry).connect(this.out)

    this.lp.connect(this.delay)
    this.delay.connect(this.feedback).connect(this.delay)
    this.delay.connect(this.echoGain).connect(this.out)

    this.lp.connect(this.convolver)
    this.convolver.connect(this.reverbGain).connect(this.out)

    this.out.connect(this.dest)
    this.stream = this.dest.stream
  }

  update(p: FxParams) {
    if (this.disposed) return
    const t = this.ctx.currentTime
    const ramp = (node: AudioParam, value: number) => {
      node.cancelScheduledValues(t)
      node.setTargetAtTime(value, t, 0.05)
    }

    this.shaper.curve = driveCurve(p.drive)

    // Радіо-смуга: чим більше, тим вужче навколо мовного діапазону.
    ramp(this.hp.frequency, 20 + p.radio * 380)
    ramp(this.lp.frequency, 20000 - p.radio * 16800)

    ramp(this.echoGain.gain, p.echo * 0.8)
    ramp(this.feedback.gain, Math.min(0.75, p.echo * 0.6))
    ramp(this.reverbGain.gain, p.reverb * 0.9)

    // Сухий сигнал трохи приглушуємо, щоб сума не клiпувала.
    ramp(this.dry.gain, 1 - Math.min(0.45, p.reverb * 0.35 + p.echo * 0.2))
    // Перевантаження додає гучності — компенсуємо на виході.
    ramp(this.out.gain, 1 - p.drive * 0.35)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const n of [this.src, this.shaper, this.hp, this.lp, this.dry, this.delay,
      this.feedback, this.echoGain, this.convolver, this.reverbGain, this.out, this.dest]) {
      try { (n as AudioNode).disconnect() } catch { /* ignore */ }
    }
  }
}
