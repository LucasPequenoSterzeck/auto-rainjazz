import type { Quality } from '../theory/chords'
import type { Mode } from './types'

/** Um compasso de uma progressão. */
export interface ProgBar {
  /** Semitons acima da tônica (0..11). */
  deg: number
  quality: Quality
}

/** Progressão de 4 compassos, sorteada com peso `weight`. */
export interface ProgTemplate {
  name: string
  mode: Mode
  weight: number
  bars: readonly ProgBar[]
}

const bar = (deg: number, quality: Quality): ProgBar => ({ deg, quality })

/** Biblioteca de progressões (todas com 4 compassos). */
export const PROGRESSIONS: readonly ProgTemplate[] = [
  {
    name: 'ii–V–I',
    mode: 'major',
    weight: 3,
    bars: [bar(2, 'm7'), bar(7, '7'), bar(0, 'maj7'), bar(0, 'maj7')],
  },
  {
    name: 'I–vi–ii–V',
    mode: 'major',
    weight: 3,
    bars: [bar(0, 'maj7'), bar(9, 'm7'), bar(2, 'm7'), bar(7, '7')],
  },
  {
    name: 'iii–VI–ii–V',
    mode: 'major',
    weight: 2,
    bars: [bar(4, 'm7'), bar(9, '7'), bar(2, 'm7'), bar(7, '7')],
  },
  {
    name: 'I–IV–iii–VI7',
    mode: 'major',
    weight: 2,
    bars: [bar(0, 'maj7'), bar(5, 'maj7'), bar(4, 'm7'), bar(9, '7')],
  },
  {
    name: 'ii–V–I–VI7',
    mode: 'major',
    weight: 3,
    bars: [bar(2, 'm7'), bar(7, '7'), bar(0, 'maj7'), bar(9, '7')],
  },
  {
    name: 'iiø–V–i–i',
    mode: 'minor',
    weight: 2,
    bars: [bar(2, 'm7b5'), bar(7, '7'), bar(0, 'm7'), bar(0, 'm7')],
  },
  {
    name: 'i–iv–iiø–V',
    mode: 'minor',
    weight: 2,
    bars: [bar(0, 'm7'), bar(5, 'm7'), bar(2, 'm7b5'), bar(7, '7')],
  },
]
