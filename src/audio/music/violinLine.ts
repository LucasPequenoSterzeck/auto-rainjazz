import type { Rng } from '../../lib/prng'
import { SHELL, chordPitchClasses, type Chord } from './theory/chords'
import { nearestMidi, pc } from './theory/notes'
import { UNITS_PER_BAR, type NoteEvent } from './melody/types'

/**
 * Papel do violino num ciclo de 4 compassos:
 * lead = melodia em legato; pad = notas-guia longas (cama harmônica); rest = silêncio.
 */
export type ViolinRole = 'lead' | 'pad' | 'rest'

/** Tessitura do violino (MIDI): D4 (62) a A5 (81). */
export const VIOLIN_LO = 62
export const VIOLIN_HI = 81

const ROLES: readonly ViolinRole[] = ['lead', 'pad', 'rest']
const ROLE_WEIGHTS: readonly number[] = [0.5, 0.35, 0.15]
/** Chance de manter a mesma nota (nota comum) quando ela ainda pertence ao acorde. */
const COMMON_TONE_PROB = 0.4
/** Chance de dividir o compasso em duas notas-guia de 4 units. */
const SPLIT_PROB = 0.35
const GUIDE_VEL_MIN = 0.32
const GUIDE_VEL_RANGE = 0.1
const HALF_BAR = UNITS_PER_BAR / 2

/** Sorteia o papel do violino. */
export function pickViolinRole(rng: Rng): ViolinRole {
  return rng.weighted(ROLES, ROLE_WEIGHTS)
}

/**
 * Legato: cada nota dura até o início da próxima; a última vai até o fim do compasso.
 * Devolve um array novo; a entrada não é alterada.
 */
export function legato(notes: readonly NoteEvent[]): NoteEvent[] {
  return notes.map((note, i) => {
    const next = notes[i + 1]
    const end = next === undefined ? UNITS_PER_BAR : next.start
    return { ...note, dur: end - note.start }
  })
}

/**
 * Uma linha de notas-guia longas (escrita clássica de cordas em ii–V–I).
 * Candidatas: 3ª e 7ª do acorde e, exceto em m7b5, a 9ª.
 */
export function guideToneBar(chord: Chord, prevMidi: number, rng: Rng): NoteEvent[] {
  const shell = SHELL[chord.quality]
  const candidates: number[] = [pc(chord.root + shell.third), pc(chord.root + shell.seventh)]
  if (chord.quality !== 'm7b5') candidates.push(pc(chord.root + 2))

  // Nota comum: mantém a mesma nota se ela ainda for do acorde.
  const prevPc = pc(prevMidi)
  const keepsCommonTone = chordPitchClasses(chord).includes(prevPc) && rng.chance(COMMON_TONE_PROB)

  let pitchClass = candidates[0] as number
  if (keepsCommonTone) {
    pitchClass = prevPc
  } else {
    let bestDist = Infinity
    for (const candidate of candidates) {
      const dist = Math.abs(nearestMidi(candidate, prevMidi, VIOLIN_LO, VIOLIN_HI) - prevMidi)
      if (dist < bestDist) {
        bestDist = dist
        pitchClass = candidate
      }
    }
  }
  const firstMidi = nearestMidi(pitchClass, prevMidi, VIOLIN_LO, VIOLIN_HI)

  if (!rng.chance(SPLIT_PROB)) {
    return [{ midi: firstMidi, start: 0, dur: UNITS_PER_BAR, velocity: guideVelocity(rng) }]
  }

  // Compasso dividido: a 2ª nota é outra candidata (outra pitch class), a mais próxima da 1ª.
  let secondMidi = firstMidi
  let bestDist = Infinity
  for (const candidate of candidates) {
    if (candidate === pitchClass) continue
    const m = nearestMidi(candidate, firstMidi, VIOLIN_LO, VIOLIN_HI)
    const dist = Math.abs(m - firstMidi)
    if (dist < bestDist) {
      bestDist = dist
      secondMidi = m
    }
  }
  return [
    { midi: firstMidi, start: 0, dur: HALF_BAR, velocity: guideVelocity(rng) },
    { midi: secondMidi, start: HALF_BAR, dur: HALF_BAR, velocity: guideVelocity(rng) },
  ]
}

function guideVelocity(rng: Rng): number {
  return GUIDE_VEL_MIN + rng.next() * GUIDE_VEL_RANGE
}
