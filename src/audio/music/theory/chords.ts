import { pc, pcName } from './notes'

export type Quality = 'maj7' | 'm7' | '7' | 'm7b5'

export interface Chord {
  /** Fundamental como pitch class 0..11 (0 = C). */
  root: number
  quality: Quality
}

/** Intervalos (semitons a partir da fundamental) das notas do acorde. */
export const CHORD_TONES: Record<Quality, readonly number[]> = {
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  '7': [0, 4, 7, 10],
  m7b5: [0, 3, 6, 10],
}

/** Voicing "shell": 3ª + 7ª + uma extensão (intervalos a partir da fundamental). */
export const SHELL: Record<Quality, { third: number; seventh: number; ext: readonly number[] }> = {
  maj7: { third: 4, seventh: 11, ext: [2, 7] },
  m7: { third: 3, seventh: 10, ext: [2, 5] },
  '7': { third: 4, seventh: 10, ext: [2, 9] },
  m7b5: { third: 3, seventh: 10, ext: [6] },
}

/** Classe de acorde usada pelo modelo de melodia. */
export type MelodyClass = 'maj' | 'min' | 'dom'

export const melodyClassOf = (q: Quality): MelodyClass =>
  q === 'maj7' ? 'maj' : q === '7' ? 'dom' : 'min'

/** Pitch classes absolutas das notas do acorde. */
export const chordPitchClasses = (c: Chord): number[] =>
  CHORD_TONES[c.quality].map((i) => pc(c.root + i))

const SUFFIX: Record<Quality, string> = { maj7: 'maj7', m7: 'm7', '7': '7', m7b5: 'm7♭5' }

export const chordName = (c: Chord): string => `${pcName(c.root)}${SUFFIX[c.quality]}`
