import * as Tone from 'tone'
import type { AmbientKind } from '../../app/types'
import { makeSeamlessLoop } from './dsp'
import { LFO_SPAN_HZ, PRESETS, centerOf, depthOf, type RainIntensity } from './presets'

/** Duração do crossfade entre presets (s). Todas as trocas de nível usam rampTo. */
const RAMP_S = 2
/** Após 'none', espera o fade terminar (com folga) antes de parar os ruídos (ms). */
const STOP_DELAY_MS = 2200
/** Taxa do LFO que varre o passa-baixas (Hz). */
const LFO_RATE_HZ = 0.09
/** Gravações de chuva (em `public/ambient/`), uma por intensidade. */
const BED_FILES: Record<RainIntensity, string> = {
  light: 'chuva-leve.mp3',
  heavy: 'chuva-forte.mp3',
}
/** Corte no início e no fim da gravação decodificada (s): descarta o preenchimento do MP3. */
const TRIM_S = 0.06
/** Crossfade da emenda do loop (s). */
const LOOP_CROSSFADE_S = 1.5
/** Fade-in de uma gravação quando ela fica pronta depois que o preset já começou (s). */
const BED_FADE_IN_S = 1

/** Uma gravação tocando em loop, com o seu fade-in próprio. */
interface BedVoice {
  source: AudioBufferSourceNode
  fade: GainNode
}

/**
 * Ambiente sonoro: chuva (gravação real em loop, leve ou forte) e brisa (ruído
 * marrom com LFO no corte do filtro + um pouco de ruído rosa filtrado).
 *
 * Grafo da brisa: a faixa do passa-baixas é o `Tone.Add` (centro) somado ao LFO. Essa
 * soma comanda `lpB.frequency`. A soma passa por um Add e não por `lpB.frequency`
 * direto porque, ao conectar um sinal em um `Signal`, o Tone zera o valor base dele e
 * ignora `rampTo`. Assim o centro e a amplitude do LFO podem ser rampeados.
 *
 * Cada gravação é baixada e decodificada uma vez (na primeira vez que é usada),
 * transformada em loop sem emenda e ligada em `gBedLight` ou `gBedHeavy`. Trocar de
 * preset faz crossfade entre elas.
 *
 * Com 'none', os ruídos, o LFO e as gravações são parados após o fade (CPU ~0).
 * Podem ser reiniciados depois com `set`.
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
  private readonly gBedLight: Tone.Gain
  private readonly gBedHeavy: Tone.Gain
  private readonly rawCtx: BaseAudioContext
  private readonly onError: (erro: unknown) => void
  /** Gravações já pedidas (uma vez por intensidade); a promessa resolve com o loop pronto. */
  private readonly bedBuffers = new Map<RainIntensity, Promise<AudioBuffer>>()
  /** Gravações tocando; são paradas e descartadas quando o preset vai a 'none'. */
  private readonly bedVoices = new Map<RainIntensity, BedVoice>()
  private kind: AmbientKind = 'none'
  private stopTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  /** Conecta a saída do motor em `out`. `onError` recebe falhas ao carregar a chuva. */
  constructor(out: Tone.ToneAudioNode, onError: (erro: unknown) => void = () => undefined) {
    const none = PRESETS.none
    this.rawCtx = Tone.getContext().rawContext
    this.onError = onError

    this.brown = new Tone.Noise('brown')
    this.pink = new Tone.Noise('pink')
    this.lpB = new Tone.Filter({ type: 'lowpass', frequency: centerOf(none.lpHz) })
    this.bpP = new Tone.Filter({ type: 'bandpass', frequency: none.bpHz, Q: 0.5 })
    this.gB = new Tone.Gain(none.brownGain)
    this.gP = new Tone.Gain(none.pinkGain)
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
  }

  /** Troca de preset com rampas (~2 s), sem estalos. Pode ser chamado a qualquer momento. */
  set(kind: AmbientKind): void {
    if (this.disposed) return
    const preset = PRESETS[kind]
    this.kind = kind
    this.cancelStopTimer()
    // Os ruídos só rodam quando o preset os usa (a chuva não usa nenhum).
    if (preset.brownGain > 0 || preset.pinkGain > 0) this.startNoises()

    this.cutoff.addend.rampTo(centerOf(preset.lpHz), RAMP_S)
    this.lfo.amplitude.rampTo(depthOf(preset.lpHz), RAMP_S)
    this.gB.gain.rampTo(preset.brownGain, RAMP_S)
    this.gP.gain.rampTo(preset.pinkGain, RAMP_S)
    this.bpP.frequency.rampTo(preset.bpHz, RAMP_S)
    // Crossfade entre as duas gravações: a ativa vai ao ganho do preset, a outra a 0.
    if (preset.bed !== 'none') this.startBed(preset.bed)
    this.gBedLight.gain.rampTo(preset.bed === 'light' ? preset.bedGain : 0, RAMP_S)
    this.gBedHeavy.gain.rampTo(preset.bed === 'heavy' ? preset.bedGain : 0, RAMP_S)

    // Depois do fade, para o que o preset não usa mais.
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null
      this.stopUnused()
    }, STOP_DELAY_MS)
  }

  /** Para tudo e libera os nós. Depois disso, `set` não faz nada. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelStopTimer()
    this.stopNoises()
    for (const intensity of Array.from(this.bedVoices.keys())) this.stopBed(intensity)
    this.brown.dispose()
    this.pink.dispose()
    this.lfo.dispose()
    this.cutoff.dispose()
    this.lpB.dispose()
    this.bpP.dispose()
    this.gB.dispose()
    this.gP.dispose()
    this.gBedLight.dispose()
    this.gBedHeavy.dispose()
  }

  private startNoises(): void {
    if (this.brown.state !== 'started') this.brown.start()
    if (this.pink.state !== 'started') this.pink.start()
    if (this.lfo.state !== 'started') this.lfo.start()
  }

  private stopNoises(): void {
    if (this.brown.state === 'started') this.brown.stop()
    if (this.pink.state === 'started') this.pink.stop()
    if (this.lfo.state === 'started') this.lfo.stop()
  }

  /** Para os ruídos e as gravações que o preset atual não usa (CPU ~0 em 'none'). */
  private stopUnused(): void {
    const preset = PRESETS[this.kind]
    if (preset.brownGain === 0 && preset.pinkGain === 0) this.stopNoises()
    for (const intensity of Array.from(this.bedVoices.keys())) {
      if (intensity !== preset.bed) this.stopBed(intensity)
    }
  }

  /** Nó de ganho da gravação da intensidade dada. */
  private bedNode(intensity: RainIntensity): Tone.Gain {
    return intensity === 'light' ? this.gBedLight : this.gBedHeavy
  }

  /**
   * Inicia a gravação em loop quando ela estiver pronta (com fade-in próprio). Não
   * duplica. Se no meio do carregamento o motor for descartado ou o preset deixar de
   * usar esta intensidade, não inicia nada.
   */
  private startBed(intensity: RainIntensity): void {
    if (this.bedVoices.has(intensity)) return
    this.requestBed(intensity).then(
      (buffer) => {
        if (this.disposed || this.bedVoices.has(intensity)) return
        if (PRESETS[this.kind].bed !== intensity) return
        const ctx = this.rawCtx
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.loop = true
        const fade = ctx.createGain()
        fade.gain.setValueAtTime(0, ctx.currentTime)
        fade.gain.linearRampToValueAtTime(1, ctx.currentTime + BED_FADE_IN_S)
        source.connect(fade)
        Tone.connect(fade, this.bedNode(intensity))
        source.start()
        this.bedVoices.set(intensity, { source, fade })
      },
      (erro: unknown) => this.onError(erro),
    )
  }

  /** Para e descarta a gravação; o loop decodificado fica para reuso. */
  private stopBed(intensity: RainIntensity): void {
    const voice = this.bedVoices.get(intensity)
    if (voice === undefined) return
    voice.source.stop()
    voice.source.disconnect()
    voice.fade.disconnect()
    this.bedVoices.delete(intensity)
  }

  /** Pede a gravação (uma vez por intensidade). Se falhar, a próxima chamada tenta de novo. */
  private requestBed(intensity: RainIntensity): Promise<AudioBuffer> {
    const cached = this.bedBuffers.get(intensity)
    if (cached !== undefined) return cached
    const promise = this.loadBed(intensity)
    this.bedBuffers.set(intensity, promise)
    promise.catch(() => this.bedBuffers.delete(intensity))
    return promise
  }

  /** Baixa, decodifica e transforma a gravação num loop sem emenda. */
  private async loadBed(intensity: RainIntensity): Promise<AudioBuffer> {
    const url = `${import.meta.env.BASE_URL}ambient/${BED_FILES[intensity]}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Chuva: falha ao baixar ${url} (HTTP ${res.status})`)
    const decoded = await this.rawCtx.decodeAudioData(await res.arrayBuffer())
    const sr = decoded.sampleRate
    const trim = Math.round(TRIM_S * sr)
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) =>
      decoded.getChannelData(c).subarray(trim, decoded.length - trim),
    )
    const loop = makeSeamlessLoop(channels, sr, LOOP_CROSSFADE_S)
    const first = loop[0]
    if (first === undefined) throw new Error(`Chuva: gravação vazia (${url})`)
    const buffer = this.rawCtx.createBuffer(loop.length, first.length, sr)
    loop.forEach((data, c) => buffer.getChannelData(c).set(data))
    return buffer
  }

  private cancelStopTimer(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
  }
}
