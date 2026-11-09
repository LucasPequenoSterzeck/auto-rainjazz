import type { Chord } from '../theory/chords'

export type Mode = 'major' | 'minor'

/** Um compasso de harmonia. */
export interface HarmonyStep {
  chord: Chord
  /** Tônica atual (pitch class 0..11). */
  key: number
  mode: Mode
  /** Nome da progressão em andamento, ex.: "ii–V–I". */
  progName: string
  /** Índice do compasso dentro da progressão (0-based). */
  barInProg: number
  progLength: number
  /** true no primeiro compasso de um ciclo cuja tonalidade mudou. */
  keyChanged: boolean
}

export interface HarmonyGen {
  /** Próximo compasso. Nunca termina. */
  next(): HarmonyStep
}
