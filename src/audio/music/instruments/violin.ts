import * as Tone from 'tone'
import { midiToName } from '../theory/notes'

/** Pasta local dos samples de violino (servidos pelo próprio app, em `public/samples/`). */
const BASE_URL = `${import.meta.env.BASE_URL}samples/violin/`
/**
 * Samples de notas sustentadas (6 s, mono). A chave é a nota do arquivo; o Sampler
 * transpõe as notas intermediárias a partir do sample mais próximo.
 */
const URLS: Record<string, string> = {
  G3: 'G3.mp3',
  A3: 'A3.mp3',
  C4: 'C4.mp3',
  E4: 'E4.mp3',
  G4: 'G4.mp3',
  A4: 'A4.mp3',
  C5: 'C5.mp3',
  E5: 'E5.mp3',
  G5: 'G5.mp3',
  A5: 'A5.mp3',
  C6: 'C6.mp3',
  E6: 'E6.mp3',
}
/** Arcada suave (s). */
const ATTACK_S = 0.09
/** Liberação do envelope (s). */
const RELEASE_S = 0.7
/** Compensa o nível dos samples, cerca de 16 dB acima dos do piano (dB). */
const VOLUME_DB = -12
/** Filtro passa-baixas para suavizar o brilho do arco (Hz). */
const FILTER_HZ = 4200

/**
 * Violino por amostras. Cadeia: sampler -> passa-baixas -> `out`.
 * Os samples só são baixados em `load()`.
 */
export class Violin {
  private readonly sampler: Tone.Sampler
  private readonly filter: Tone.Filter
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
      urls: URLS,
      baseUrl: BASE_URL,
      attack: ATTACK_S,
      release: RELEASE_S,
      volume: VOLUME_DB,
      onload: () => this.resolveReady(),
      onerror: (erro: Error) => this.rejectReady(erro),
    })
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: FILTER_HZ })

    this.sampler.connect(this.filter)
    this.filter.connect(out)
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
  }
}
