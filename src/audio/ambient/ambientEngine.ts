import * as Tone from 'tone'
import type { AmbientKind } from '../../app/types'
import { makeDropData, makeRainBed, poisson } from './dsp'
import type { RainBed, RainIntensity } from './dsp'

/** Duração do crossfade entre presets (s). Todas as trocas de nível usam rampTo. */
const RAMP_S = 2
/** Duração da rampa do bus de gotas (s). */
const DROP_RAMP_S = 1
/** Após 'none', espera o fade terminar (com folga) antes de parar os ruídos (ms). */
const STOP_DELAY_MS = 2200
/** Período do agendador de gotas (ms). */
const DROP_TICK_MS = 80
/** Taxa do LFO que varre o passa-baixas (Hz). */
const LFO_RATE_HZ = 0.09
/** Excursão máxima do LFO (Hz). A faixa real vem de lfo.amplitude. */
const LFO_SPAN_HZ = 400
/** Quantidade de buffers de gota gerados uma vez. */
const DROP_BUFFER_COUNT = 6
/** Duração do loop de chuva gerado (s). Gerado lazy, na primeira vez que o bed é usado. */
const BED_LOOP_S = 12

interface Preset {
  /** Loop de chuva usado ('none' = nenhum). */
  bed: 'none' | RainIntensity
  /** Ganho do loop de chuva. */
  bedGain: number
  /** Ganho do ruído marrom (grave). */
  brownGain: number
  /** Faixa do passa-baixas [min, max] em Hz. */
  lpHz: readonly [number, number]
  /** Ganho do ruído rosa (médio agudo). */
  pinkGain: number
  /** Frequência central do passa-faixa do ruído rosa (Hz). */
  bpHz: number
  /** Gotas (impactos) por segundo. */
  dropsPerSec: number
  /** Ganho do bus de gotas. */
  dropGain: number
}

const PRESETS: Record<AmbientKind, Preset> = {
  none: {
    bed: 'none',
    bedGain: 0,
    brownGain: 0,
    lpHz: [300, 600],
    pinkGain: 0,
    bpHz: 3000,
    dropsPerSec: 0,
    dropGain: 0,
  },
  wind: {
    bed: 'none',
    bedGain: 0,
    brownGain: 0.55,
    lpHz: [220, 900],
    pinkGain: 0.05,
    bpHz: 1200,
    dropsPerSec: 0,
    dropGain: 0,
  },
  lightRain: {
    bed: 'light',
    bedGain: 0.55,
    brownGain: 0.04,
    lpHz: [300, 500],
    pinkGain: 0,
    bpHz: 3200,
    dropsPerSec: 3,
    dropGain: 0.1,
  },
  rain: {
    bed: 'heavy',
    bedGain: 0.65,
    brownGain: 0.12,
    lpHz: [350, 600],
    pinkGain: 0,
    bpHz: 2600,
    dropsPerSec: 6,
    dropGain: 0.09,
  },
}

/** Centro da faixa do passa-baixas (Hz). */
const centerOf = (range: readonly [number, number]): number => (range[0] + range[1]) / 2

/** Amplitude normalizada do LFO que cobre metade da faixa. */
const depthOf = (range: readonly [number, number]): number => (range[1] - range[0]) / 2 / LFO_SPAN_HZ

/** Uma gota em reprodução; os três nós são desconectados quando ela termina. */
interface DropVoice {
  source: AudioBufferSourceNode
  gain: GainNode
  panner: StereoPannerNode
}

/**
 * Ambiente sonoro: ruído marrom (vento/grave), ruído rosa filtrado, loop de chuva
 * (bed estéreo) e gotas raras.
 *
 * Grafo: a faixa do passa-baixas é o `Tone.Add` (centro) somado ao LFO. Essa soma
 * comanda `lpB.frequency`. A soma passa por um Add e não por `lpB.frequency` direto
 * porque, ao conectar um sinal em um `Signal`, o Tone zera o valor base dele e
 * ignora `rampTo`. Assim o centro e a amplitude do LFO podem ser rampeados.
 *
 * O loop de chuva é um `AudioBufferSourceNode` (em loop) por intensidade, gerado
 * lazy e ligado em `gBedLight` ou `gBedHeavy`. Trocar de preset faz crossfade entre eles.
 *
 * Com 'none', os ruídos, o LFO e os loops são parados após o fade, e o agendador de
 * gotas para já (CPU ~0). Podem ser reiniciados depois com `set`.
 */
export class AmbientEngine {
  private readonly brown: Tone.Noise
  private readonly pink: Tone.Noise
  private readonly lpB: Tone.Filter
  private readonly bpP: Tone.Filter
  private readonly lfo: Tone.LFO
  private readonly cutoff: Tone.Add
  private readonly gB: Tone.Gain
  private readonly gP: Tone.Gain
  private readonly dropBus: Tone.Gain
  private readonly gBedLight: Tone.Gain
  private readonly gBedHeavy: Tone.Gain
  private readonly rawCtx: BaseAudioContext
  private readonly dropBuffers: AudioBuffer[]
  /** Loops de chuva já gerados (uma vez por intensidade). */
  private readonly bedBuffers = new Map<RainIntensity, AudioBuffer>()
  /** Fontes de loop ativas; são paradas e descartadas quando o preset vai a 'none'. */
  private readonly bedSources = new Map<RainIntensity, AudioBufferSourceNode>()
  private readonly voices = new Set<DropVoice>()
  private kind: AmbientKind = 'none'
  /** Gotas por segundo do preset atual. */
  private density = 0
  private stopTimer: ReturnType<typeof setTimeout> | null = null
  private dropTimer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  /** Conecta a saída do motor em `out`. */
  constructor(out: Tone.ToneAudioNode) {
    const none = PRESETS.none
    this.rawCtx = Tone.getContext().rawContext

    this.brown = new Tone.Noise('brown')
    this.pink = new Tone.Noise('pink')
    this.lpB = new Tone.Filter({ type: 'lowpass', frequency: centerOf(none.lpHz) })
    this.bpP = new Tone.Filter({ type: 'bandpass', frequency: none.bpHz, Q: 0.5 })
    this.gB = new Tone.Gain(none.brownGain)
    this.gP = new Tone.Gain(none.pinkGain)
    this.dropBus = new Tone.Gain(none.dropGain)
    this.gBedLight = new Tone.Gain(0)
    this.gBedHeavy = new Tone.Gain(0)
    this.gBedLight.connect(out)
    this.gBedHeavy.connect(out)

    this.cutoff = new Tone.Add(centerOf(none.lpHz))
    this.lfo = new Tone.LFO({
      frequency: LFO_RATE_HZ,
      type: 'sine',
      min: -LFO_SPAN_HZ,
      max: LFO_SPAN_HZ,
      amplitude: depthOf(none.lpHz),
    })
    this.lfo.connect(this.cutoff)
    this.cutoff.connect(this.lpB.frequency)

    this.brown.connect(this.lpB)
    this.lpB.connect(this.gB)
    this.gB.connect(out)
    this.pink.connect(this.bpP)
    this.bpP.connect(this.gP)
    this.gP.connect(out)
    this.dropBus.connect(out)

    this.dropBuffers = Array.from({ length: DROP_BUFFER_COUNT }, () => {
      const data = makeDropData(this.rawCtx.sampleRate, Math.random)
      const buffer = this.rawCtx.createBuffer(1, data.length, this.rawCtx.sampleRate)
      buffer.getChannelData(0).set(data)
      return buffer
    })
  }

  /** Troca de preset com rampas (~2 s), sem estalos. Pode ser chamado a qualquer momento. */
  set(kind: AmbientKind): void {
    if (this.disposed) return
    const preset = PRESETS[kind]
    this.kind = kind
    this.density = preset.dropsPerSec
    this.cancelStopTimer()
    if (kind !== 'none') this.startSources()

    this.cutoff.addend.rampTo(centerOf(preset.lpHz), RAMP_S)
    this.lfo.amplitude.rampTo(depthOf(preset.lpHz), RAMP_S)
    this.gB.gain.rampTo(preset.brownGain, RAMP_S)
    this.gP.gain.rampTo(preset.pinkGain, RAMP_S)
    this.bpP.frequency.rampTo(preset.bpHz, RAMP_S)
    this.dropBus.gain.rampTo(preset.dropGain, DROP_RAMP_S)
    // Crossfade entre os dois loops: o ativo vai ao ganho do preset, o outro a 0.
    if (preset.bed !== 'none') this.startBed(preset.bed)
    this.gBedLight.gain.rampTo(preset.bed === 'light' ? preset.bedGain : 0, RAMP_S)
    this.gBedHeavy.gain.rampTo(preset.bed === 'heavy' ? preset.bedGain : 0, RAMP_S)
    this.syncDropTimer()

    if (kind === 'none') {
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null
        if (this.kind === 'none') this.stopSources()
      }, STOP_DELAY_MS)
    }
  }

  /** Para tudo e libera os nós. Depois disso, `set` não faz nada. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelStopTimer()
    this.syncDropTimerOff()
    this.stopSources()
    for (const voice of Array.from(this.voices)) {
      voice.source.stop()
      this.releaseVoice(voice)
    }
    this.brown.dispose()
    this.pink.dispose()
    this.lfo.dispose()
    this.cutoff.dispose()
    this.lpB.dispose()
    this.bpP.dispose()
    this.gB.dispose()
    this.gP.dispose()
    this.dropBus.dispose()
    this.gBedLight.dispose()
    this.gBedHeavy.dispose()
  }

  private startSources(): void {
    if (this.brown.state !== 'started') this.brown.start()
    if (this.pink.state !== 'started') this.pink.start()
    if (this.lfo.state !== 'started') this.lfo.start()
  }

  private stopSources(): void {
    if (this.brown.state === 'started') this.brown.stop()
    if (this.pink.state === 'started') this.pink.stop()
    if (this.lfo.state === 'started') this.lfo.stop()
    for (const intensity of Array.from(this.bedSources.keys())) this.stopBed(intensity)
  }

  /** Nó de ganho do loop de chuva da intensidade dada. */
  private bedNode(intensity: RainIntensity): Tone.Gain {
    return intensity === 'light' ? this.gBedLight : this.gBedHeavy
  }

  /** Cria (se preciso) e inicia a fonte em loop da intensidade. Não duplica fontes. */
  private startBed(intensity: RainIntensity): void {
    if (this.bedSources.has(intensity)) return
    let buffer = this.bedBuffers.get(intensity)
    if (buffer === undefined) {
      buffer = this.makeBedBuffer(intensity)
      this.bedBuffers.set(intensity, buffer)
    }
    const source = this.rawCtx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    Tone.connect(source, this.bedNode(intensity))
    source.start()
    this.bedSources.set(intensity, source)
  }

  /** Para e descarta a fonte do loop; o buffer gerado fica para reuso. */
  private stopBed(intensity: RainIntensity): void {
    const source = this.bedSources.get(intensity)
    if (source === undefined) return
    source.stop()
    source.disconnect()
    this.bedSources.delete(intensity)
  }

  /** Gera o loop estéreo (uma vez) e o converte em AudioBuffer. */
  private makeBedBuffer(intensity: RainIntensity): AudioBuffer {
    const sr = this.rawCtx.sampleRate
    const bed: RainBed = makeRainBed(sr, BED_LOOP_S, intensity, Math.random)
    const buffer = this.rawCtx.createBuffer(2, bed.left.length, sr)
    buffer.getChannelData(0).set(bed.left)
    buffer.getChannelData(1).set(bed.right)
    return buffer
  }

  /** O agendador de gotas só roda quando há densidade > 0. */
  private syncDropTimer(): void {
    if (this.density > 0 && this.dropTimer === null) {
      this.dropTimer = setInterval(() => this.tickDrops(), DROP_TICK_MS)
    } else if (this.density <= 0) {
      this.syncDropTimerOff()
    }
  }

  private syncDropTimerOff(): void {
    if (this.dropTimer !== null) {
      clearInterval(this.dropTimer)
      this.dropTimer = null
    }
  }

  private cancelStopTimer(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
  }

  /** Sorteia quantas gotas caem neste tique (Poisson) e as dispara. */
  private tickDrops(): void {
    // Com o contexto suspenso, as gotas não tocariam e se acumulariam na fila.
    if (this.disposed || this.rawCtx.state !== 'running') return
    const n = poisson((this.density * DROP_TICK_MS) / 1000, Math.random)
    for (let i = 0; i < n; i++) this.playDrop()
  }

  private playDrop(): void {
    const ctx = this.rawCtx
    const buffer = this.dropBuffers[Math.floor(Math.random() * this.dropBuffers.length)]

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 0.8 + Math.random() * 0.5

    const gain = ctx.createGain()
    gain.gain.value = 0.4 + Math.random() * 0.6

    const panner = ctx.createStereoPanner()
    panner.pan.value = -0.8 + Math.random() * 1.6

    source.connect(gain)
    gain.connect(panner)
    Tone.connect(panner, this.dropBus)

    const voice: DropVoice = { source, gain, panner }
    this.voices.add(voice)
    source.onended = () => this.releaseVoice(voice)
    source.start(ctx.currentTime + 0.02 + Math.random() * 0.08)
  }

  private releaseVoice(voice: DropVoice): void {
    voice.source.disconnect()
    voice.gain.disconnect()
    voice.panner.disconnect()
    this.voices.delete(voice)
  }
}
