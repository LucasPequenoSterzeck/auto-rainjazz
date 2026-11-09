import type { MelodyClass } from '../theory/chords'

/**
 * Frases de 1 compasso (soma das durações = 8 units) relativas à fundamental do acorde.
 * Token `pc:dur`: pc = semitons acima da fundamental (0..11); `r` = pausa; dur em units.
 */
export const CORPUS: Record<MelodyClass, readonly string[]> = {
  maj: [
    '4:2 7:2 11:3 r:1',
    'r:2 7:1 9:1 11:2 r:2',
    '0:3 r:1 4:2 2:2',
    '11:2 9:1 7:1 4:4',
    '7:4 r:2 4:2',
    'r:1 4:1 7:2 9:2 7:2',
    '2:2 4:2 7:4',
    '11:4 r:1 9:1 7:2',
    '4:3 r:1 2:1 0:3',
    'r:4 7:2 11:2',
  ],
  min: [
    '3:2 7:2 10:3 r:1',
    'r:2 5:1 7:1 10:2 r:2',
    '0:3 r:1 3:2 2:2',
    '10:2 7:1 5:1 3:4',
    '7:4 r:2 3:2',
    'r:1 3:1 5:2 7:2 10:2',
    '2:2 3:2 7:4',
    '10:4 r:1 9:1 7:2',
    '3:3 r:1 2:1 0:3',
    'r:4 7:2 10:2',
  ],
  dom: [
    '4:2 7:2 10:3 r:1',
    'r:2 9:1 10:1 7:2 r:2',
    '10:3 r:1 9:2 7:2',
    '7:2 5:1 4:1 2:4',
    '4:4 r:2 7:2',
    'r:1 7:1 9:2 10:2 7:2',
    '0:2 2:2 4:4',
    '10:4 r:1 9:1 7:2',
    '7:3 r:1 4:1 2:3',
    'r:4 4:2 10:2',
  ],
}
