import type { Chord } from '../theory/chords'

/** Um compasso 4/4 = 8 colcheias ("units"). */
export const UNITS_PER_BAR = 8

export interface NoteEvent {
  /** Nota MIDI. */
  midi: number
  /** Início em units dentro do compasso (0..7). */
  start: number
  /** Duração em units (>= 1). start + dur <= 8. */
  dur: number
  /** Velocity 0..1. */
  velocity: number
}

export interface BarContext {
  chord: Chord
  /** Índice do compasso desde o início da execução. */
  barIndex: number
}

/** Contrato plugável: MarkovMelody (v1) e MagentaMelody (v2) implementam isto. */
export interface MelodyGenerator {
  /** Gera as notas (ordenadas por start, sem sobreposição) de UM compasso sobre o acorde. */
  nextBar(ctx: BarContext): NoteEvent[]
  /** Reinicia o estado e a aleatoriedade com uma nova seed. */
  reset(seed: number): void
}
