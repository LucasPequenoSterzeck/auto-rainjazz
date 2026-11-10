import * as Tone from 'tone'
import { createRng, type Rng } from '../../lib/prng'
import { HarmonyGenerator } from './harmony/harmonyGenerator'
import type { HarmonyStep } from './harmony/types'
import { MarkovMelody } from './melody/markovMelody'
import type { NoteEvent } from './melody/types'
import { Piano } from './instruments/piano'
import { Violin } from './instruments/violin'
import { legato, guideToneBar, pickViolinRole, type ViolinRole } from './violinLine'
import { SHELL, chordName, type Chord } from './theory/chords'
import { pcName } from './theory/notes'
import { voiceChord, type Voicing } from './voicing'

/** Informação de exibição de um compasso que começou a tocar. */
export interface BarInfo {
  chord: string
  key: string
  prog: string
  bpm: number
}

/** Conjunto de instrumentos: só piano, ou piano + violino. */
export type Lineup = 'piano' | 'pianoViolin'

/** Intervalo de agendamento: 1 compasso 4/4 no Transport. */
const BAR_INTERVAL = '1m'
const BPM_MIN = 56
const BPM_RANGE = 16
/** Constantes de XOR para derivar as sementes dos sub-geradores. */
const MELODY_SEED_XOR = 0x9e3779b9
const FX_SEED_XOR = 0x2c1b3c6d
const VIOLIN_SEED_XOR = 0x7f4a7c15
/** Atraso inicial ao dar start no Transport (s). */
const START_DELAY = '+0.1'
/** Nota inicial de referência do violino (guia de voice leading), C5. */
const VIOLIN_START_MIDI = 72

/**
 * Reverberação compartilhada por piano e violino: o mesmo JCReverb da v1 (o piano soa
 * exatamente como antes). Um Tone.Reverb (convolução) foi testado e o usuário reprovou o som.
 */
const REVERB_ROOM_SIZE = 0.5
const REVERB_WET = 0.3

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
const VIOLIN_DUR_FACTOR = 1.04
const VIOLIN_LEAD_VEL_FACTOR = 0.85

/**
 * Motor musical: harmonia + melodia Markov + piano (+ violino opcional), agendados no Transport.
 * `start` e `stop` podem ser chamados várias vezes sem duplicar agendamentos.
 */
export class MusicEngine {
  /** Reverb compartilhado: piano e violino saem por ele, e ele sai no `out`. */
  private readonly reverb: Tone.JCReverb
  private piano: Piano | null = null
  private violin: Violin | null = null
  private pianoLoaded = false
  private violinLoaded = false
  private lineup: Lineup = 'piano'
  private harmony: HarmonyGenerator | null = null
  private melody: MarkovMelody | null = null
  /** Rng próprio (derivado da seed) para jitter, extensão e recomposição. */
  private fx: Rng = createRng(0)
  /** Rng próprio do violino (papel, notas-guia e jitter), separado do `fx` do piano. */
  private violinRng: Rng = createRng(0)
  private role: ViolinRole = 'rest'
  /** true quando o papel do violino deve ser sorteado no próximo compasso. */
  private needRole = true
  /** Última nota tocada pelo violino (ponto de partida do voice leading das notas-guia). */
  private violinLast = VIOLIN_START_MIDI
  private prevVoicing: Voicing | null = null
  private barIndex = 0
  private bpm = 0
  private onBar: ((info: BarInfo) => void) | null = null

  constructor(out: Tone.ToneAudioNode) {
    this.reverb = new Tone.JCReverb({ roomSize: REVERB_ROOM_SIZE, wet: REVERB_WET })
    this.reverb.connect(out)
  }

  /**
   * Garante os instrumentos do `lineup` (idempotente). Se um download falhar, descarta o
   * instrumento para que uma nova chamada a load() tente de novo. Piano e violino carregam em paralelo.
   */
  async load(lineup: Lineup): Promise<void> {
    const tarefas: Promise<void>[] = [this.loadPiano()]
    if (lineup === 'pianoViolin') tarefas.push(this.loadViolin())
    await Promise.all(tarefas)
  }

  private async loadPiano(): Promise<void> {
    if (this.piano === null) this.piano = new Piano(this.reverb)
    const piano = this.piano
    try {
      await piano.load()
      this.pianoLoaded = true
    } catch (erro: unknown) {
      if (this.piano === piano) {
        this.piano = null
        piano.dispose()
      }
      throw erro
    }
  }

  private async loadViolin(): Promise<void> {
    if (this.violin === null) this.violin = new Violin(this.reverb)
    const violin = this.violin
    try {
      await violin.load()
      this.violinLoaded = true
    } catch (erro: unknown) {
      if (this.violin === violin) {
        this.violin = null
        violin.dispose()
      }
      throw erro
    }
  }

  /** true se os instrumentos do `lineup` estiverem carregados. */
  isLoaded(lineup: Lineup): boolean {
    if (lineup === 'piano') return this.pianoLoaded
    return this.pianoLoaded && this.violinLoaded
  }

  /** Inicia a música com a seed e o conjunto de instrumentos. Se já estiver tocando, reinicia sem duplicar agendamentos. */
  start(seed: number, lineup: Lineup, onBar: (info: BarInfo) => void): void {
    if (!this.pianoLoaded) throw new Error('MusicEngine: chame load() antes de start()')
    if (lineup === 'pianoViolin' && !this.violinLoaded) {
      throw new Error("MusicEngine: chame load('pianoViolin') antes de start()")
    }
    this.halt()

    const rng = createRng(seed)
    this.harmony = new HarmonyGenerator(rng)
    this.melody = new MarkovMelody(createRng(seed ^ MELODY_SEED_XOR))
    this.fx = createRng(seed ^ FX_SEED_XOR)
    this.onBar = onBar
    this.prevVoicing = null
    this.barIndex = 0
    this.bpm = BPM_MIN + rng.int(0, BPM_RANGE)
    this.lineup = lineup
    this.violinRng = createRng(seed ^ VIOLIN_SEED_XOR)
    this.role = 'rest'
    this.needRole = true
    this.violinLast = VIOLIN_START_MIDI

    const transport = Tone.getTransport()
    transport.bpm.value = this.bpm
    transport.scheduleRepeat((time) => this.playBar(time), BAR_INTERVAL)
    transport.start(START_DELAY)
  }

  /**
   * Troca o conjunto de instrumentos ao vivo (vale a partir do próximo compasso).
   * Voltar para `piano` solta o violino; entrar em `pianoViolin` sorteia um novo papel.
   */
  setLineup(lineup: Lineup): void {
    if (lineup === 'pianoViolin' && !this.violinLoaded) {
      throw new Error("MusicEngine: chame load('pianoViolin') antes de setLineup()")
    }
    if (lineup === 'piano') this.violin?.releaseAll()
    else this.needRole = true
    this.lineup = lineup
  }

  /** Para o Transport, remove os agendamentos e solta as notas que estiverem soando. */
  stop(): void {
    this.halt()
    this.harmony = null
    this.melody = null
    this.onBar = null
    this.prevVoicing = null
    this.role = 'rest'
    this.needRole = true
    this.violinLast = VIOLIN_START_MIDI
  }

  /** Interrompe agendamentos e notas, sem descartar o estado dos instrumentos. */
  private halt(): void {
    const transport = Tone.getTransport()
    transport.stop()
    transport.cancel(0)
    Tone.getDraw().cancel(0)
    this.piano?.releaseAll()
    this.violin?.releaseAll()
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

    // Papel do violino: sorteado no início de cada ciclo de 4 compassos (ou quando pedido).
    const violin = this.lineup === 'pianoViolin' ? this.violin : null
    if (violin !== null && (step.barInProg === 0 || this.needRole)) {
      this.role = pickViolinRole(this.violinRng)
      this.needRole = false
    }

    // Melodia do compasso: sempre consumida, para manter a sequência do piano determinística.
    const notes: NoteEvent[] = melody.nextBar({ chord, barIndex: this.barIndex })
    const violinLead = violin !== null && this.role === 'lead'
    if (violinLead) {
      this.playViolinLead(violin, notes, time, unit)
    } else {
      this.playPianoMelody(piano, notes, time, unit)
    }
    if (violin !== null && this.role === 'pad') {
      this.playViolinPad(violin, chord, time, unit)
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

  /** Melodia no piano (papel do piano, ou sem violino). */
  private playPianoMelody(piano: Piano, notes: readonly NoteEvent[], time: number, unit: number): void {
    const fx = this.fx
    for (const note of notes) {
      const swing = note.start % 2 === 1 ? SWING * unit : 0
      const jitter = (fx.next() - 0.5) * JITTER_S
      const noteTime = time + note.start * unit + swing + jitter
      piano.play(note.midi, note.dur * unit * MELODY_DUR_FACTOR, noteTime, note.velocity)
    }
  }

  /** Melodia em legato no violino (papel lead). */
  private playViolinLead(violin: Violin, notes: readonly NoteEvent[], time: number, unit: number): void {
    const rng = this.violinRng
    for (const note of legato(notes)) {
      const swing = note.start % 2 === 1 ? SWING * unit : 0
      const jitter = (rng.next() - 0.5) * JITTER_S
      const noteTime = time + note.start * unit + swing + jitter
      violin.play(note.midi, note.dur * unit * VIOLIN_DUR_FACTOR, noteTime, note.velocity * VIOLIN_LEAD_VEL_FACTOR)
      this.violinLast = note.midi
    }
  }

  /** Notas-guia longas no violino (papel pad). */
  private playViolinPad(violin: Violin, chord: Chord, time: number, unit: number): void {
    const rng = this.violinRng
    for (const note of guideToneBar(chord, this.violinLast, rng)) {
      const jitter = (rng.next() - 0.5) * JITTER_S
      const noteTime = time + note.start * unit + jitter
      violin.play(note.midi, note.dur * unit * VIOLIN_DUR_FACTOR, noteTime, note.velocity)
      this.violinLast = note.midi
    }
  }
}
