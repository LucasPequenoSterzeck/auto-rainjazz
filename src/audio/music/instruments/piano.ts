import * as Tone from 'tone'
import { midiToName } from '../theory/notes'

/** Pasta hospedada dos samples Salamander (Tone.js). */
const BASE_URL = 'https://tonejs.github.io/audio/salamander/'
/** Amostragem: um sample a cada 3 semitons, de C2 (36) a C7 (96). */
const FIRST_MIDI = 36
const LAST_MIDI = 96
const SAMPLE_STEP = 3
/** Liberação do envelope (s). */
const RELEASE_S = 1.2
/** Filtro passa-baixas de cor do piano (Hz). */
const FILTER_HZ = 5200
/** Reverberação suave. */
const ROOM_SIZE = 0.5
const REVERB_WET = 0.3

/**
 * Mapa `urls` do Sampler: a chave é o nome da nota com '#' ("D#2"),
 * o arquivo usa 's' no lugar do sustenido ("Ds2.mp3").
 */
function buildUrls(): Record<string, string> {
  const urls: Record<string, string> = {}
  for (let midi = FIRST_MIDI; midi <= LAST_MIDI; midi += SAMPLE_STEP) {
    const name = midiToName(midi)
    urls[name] = `${name.replace('#', 's')}.mp3`
  }
  return urls
}

/**
 * Piano por amostras (Salamander). Cadeia: sampler -> passa-baixas -> reverb -> `out`.
 * Os samples só são baixados em `load()`.
 */
export class Piano {
  private readonly sampler: Tone.Sampler
  private readonly filter: Tone.Filter
  private readonly reverb: Tone.JCReverb
  private readonly ready: Promise<void>
  private resolveReady: () => void = () => undefined
  private rejectReady: (erro: Error) => void = () => undefined

  constructor(out: Tone.ToneAudioNode) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    // Evita "unhandled rejection" se o erro ocorrer antes de alguém aguardar load().
    this.ready.catch(() => undefined)

    this.sampler = new Tone.Sampler({
      urls: buildUrls(),
      baseUrl: BASE_URL,
      release: RELEASE_S,
      onload: () => this.resolveReady(),
      onerror: (erro: Error) => this.rejectReady(erro),
    })
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: FILTER_HZ })
    this.reverb = new Tone.JCReverb({ roomSize: ROOM_SIZE, wet: REVERB_WET })

    this.sampler.connect(this.filter)
    this.filter.connect(this.reverb)
    this.reverb.connect(out)
  }

  /** Resolve quando todos os samples estiverem carregados; rejeita em falha de download. */
  load(): Promise<void> {
    return this.ready
  }

  /** Toca uma nota MIDI. `time` em segundos do AudioContext; `velocity` 0..1. */
  play(midi: number, durSec: number, time: number, velocity: number): void {
    this.sampler.triggerAttackRelease(midiToName(midi), durSec, time, velocity)
  }

  /** Solta todas as notas que estiverem soando. */
  releaseAll(): void {
    this.sampler.releaseAll()
  }

  dispose(): void {
    this.sampler.dispose()
    this.filter.dispose()
    this.reverb.dispose()
  }
}
