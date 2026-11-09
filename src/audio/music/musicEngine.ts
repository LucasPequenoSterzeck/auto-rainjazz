import * as Tone from 'tone'
import { createRng, type Rng } from '../../lib/prng'
import { HarmonyGenerator } from './harmony/harmonyGenerator'
import type { HarmonyStep } from './harmony/types'
import { MarkovMelody } from './melody/markovMelody'
import type { NoteEvent } from './melody/types'
import { Piano } from './instruments/piano'
import { SHELL, chordName } from './theory/chords'
import { pcName } from './theory/notes'
import { voiceChord, type Voicing } from './voicing'

/** Informação de exibição de um compasso que começou a tocar. */
export interface BarInfo {
  chord: string
  key: string
  prog: string
  bpm: number
}

/** Intervalo de agendamento: 1 compasso 4/4 no Transport. */
const BAR_INTERVAL = '1m'
const BPM_MIN = 56
const BPM_RANGE = 16
/** Constantes de XOR para derivar as sementes dos sub-geradores. */
const MELODY_SEED_XOR = 0x9e3779b9
const FX_SEED_XOR = 0x2c1b3c6d
/** Atraso inicial ao dar start no Transport (s). */
const START_DELAY = '+0.1'

const BASS_VELOCITY = 0.45
const BASS_DUR_BEATS = 3.4
const CHORD_DUR_BEATS = 2.6
const CHORD_STAGGER_S = 0.022
const CHORD_ONSET_S = 0.02
const CHORD_VEL_MIN = 0.3
const CHORD_VEL_RANGE = 0.12
const JITTER_S = 0.024
const RECOMP_PROB = 0.45
const RECOMP_START_UNITS = 5
const RECOMP_DUR_BEATS = 1.2
const RECOMP_VEL_MIN = 0.22
const RECOMP_VEL_RANGE = 0.08
const SWING = 0.14
const MELODY_DUR_FACTOR = 0.95

/**
 * Motor musical: harmonia + melodia Markov + piano, agendados no Transport.
 * `start` e `stop` podem ser chamados várias vezes sem duplicar agendamentos.
 */
export class MusicEngine {
  private readonly out: Tone.ToneAudioNode
  private piano: Piano | null = null
  private harmony: HarmonyGenerator | null = null
  private melody: MarkovMelody | null = null
  /** Rng próprio (derivado da seed) para jitter, extensão e recomposição. */
  private fx: Rng = createRng(0)
  private prevVoicing: Voicing | null = null
  private barIndex = 0
  private bpm = 0
  private onBar: ((info: BarInfo) => void) | null = null

  constructor(out: Tone.ToneAudioNode) {
    this.out = out
  }

  /**
   * Cria o piano e baixa os samples (idempotente). Se o download falhar, descarta o piano
   * para que uma nova chamada a load() tente de novo.
   */
  async load(): Promise<void> {
    if (this.piano === null) this.piano = new Piano(this.out)
    const piano = this.piano
    try {
      await piano.load()
    } catch (erro: unknown) {
      if (this.piano === piano) {
        this.piano = null
        piano.dispose()
      }
      throw erro
    }
  }

  /** Inicia a música com a seed. Se já estiver tocando, reinicia sem duplicar agendamentos. */
  start(seed: number, onBar: (info: BarInfo) => void): void {
    if (this.piano === null) throw new Error('MusicEngine: chame load() antes de start()')
    this.halt()

    const rng = createRng(seed)
    this.harmony = new HarmonyGenerator(rng)
    this.melody = new MarkovMelody(createRng(seed ^ MELODY_SEED_XOR))
    this.fx = createRng(seed ^ FX_SEED_XOR)
    this.onBar = onBar
    this.prevVoicing = null
    this.barIndex = 0
    this.bpm = BPM_MIN + rng.int(0, BPM_RANGE)

    const transport = Tone.getTransport()
    transport.bpm.value = this.bpm
    transport.scheduleRepeat((time) => this.playBar(time), BAR_INTERVAL)
    transport.start(START_DELAY)
  }

  /** Para o Transport, remove os agendamentos e solta as notas que estiverem soando. */
  stop(): void {
    this.halt()
    this.harmony = null
    this.melody = null
    this.onBar = null
    this.prevVoicing = null
  }

  /** Interrompe agendamentos e notas, sem descartar o estado do piano. */
  private halt(): void {
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel(0)
    Tone.getDraw().cancel(0)
    this.piano?.releaseAll()
  }

  /** Agenda um compasso inteiro começando em `time` (segundos do AudioContext). */
  private playBar(time: number): void {
    const { harmony, melody, piano, onBar } = this
    if (harmony === null || melody === null || piano === null || onBar === null) return
    const fx = this.fx
    const beat = 60 / this.bpm
    const unit = beat / 2

    const step: HarmonyStep = harmony.next()
    const { chord } = step
    const ext = fx.pick(SHELL[chord.quality].ext)
    const voicing = voiceChord(chord, this.prevVoicing, ext)
    this.prevVoicing = voicing

    // Baixo na batida 1.
    piano.play(voicing.bass, BASS_DUR_BEATS * beat, time, BASS_VELOCITY)

    // Acorde arpejado levemente, com jitter.
    voicing.notes.forEach((midi, i) => {
      const jitter = (fx.next() - 0.5) * JITTER_S
      const velocity = CHORD_VEL_MIN + fx.next() * CHORD_VEL_RANGE
      piano.play(midi, CHORD_DUR_BEATS * beat, time + CHORD_ONSET_S + i * CHORD_STAGGER_S + jitter, velocity)
    })

    // Recomposição (comping) no contratempo do 3º tempo, às vezes.
    if (fx.chance(RECOMP_PROB)) {
      const recompTime = time + RECOMP_START_UNITS * unit
      for (const midi of voicing.notes) {
        const velocity = RECOMP_VEL_MIN + fx.next() * RECOMP_VEL_RANGE
        piano.play(midi, RECOMP_DUR_BEATS * beat, recompTime, velocity)
      }
    }

    // Melodia do compasso.
    const notes: NoteEvent[] = melody.nextBar({ chord, barIndex: this.barIndex })
    for (const note of notes) {
      const swing = note.start % 2 === 1 ? SWING * unit : 0
      const jitter = (fx.next() - 0.5) * JITTER_S
      const noteTime = time + note.start * unit + swing + jitter
      piano.play(note.midi, note.dur * unit * MELODY_DUR_FACTOR, noteTime, note.velocity)
    }

    // Exibição sincronizada com o áudio (no quadro de animação do tempo agendado).
    const info: BarInfo = {
      chord: chordName(chord),
      key: `${pcName(step.key)} ${step.mode === 'major' ? 'maior' : 'menor'}`,
      prog: step.progName,
      bpm: this.bpm,
    }
    Tone.getDraw().schedule(() => onBar(info), time)

    this.barIndex++
  }
}
