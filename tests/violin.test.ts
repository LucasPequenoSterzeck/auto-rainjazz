import { describe, expect, it } from 'vitest'
import { createRng } from '../src/lib/prng'
import { chordPitchClasses, type Chord, type Quality } from '../src/audio/music/theory/chords'
import { pc } from '../src/audio/music/theory/notes'
import type { NoteEvent } from '../src/audio/music/melody/types'
import {
  VIOLIN_HI,
  VIOLIN_LO,
  guideToneBar,
  legato,
  pickViolinRole,
} from '../src/audio/music/violinLine'

const QUALITIES: readonly Quality[] = ['maj7', 'm7', '7', 'm7b5']
const SEEDS = [1, 7, 42, 1234, 99991]

/** Pitch classes permitidas: notas do acorde (a nota comum pode ser qualquer uma) e a 9ª. */
function allowedPcs(chord: Chord): number[] {
  const pcs = chordPitchClasses(chord)
  if (chord.quality !== 'm7b5') pcs.push(pc(chord.root + 2))
  return pcs
}

describe('legato', () => {
  it('preenche as lacunas até o start da próxima nota e estende a última até 8', () => {
    const entrada: NoteEvent[] = [
      { midi: 70, start: 0, dur: 1, velocity: 0.5 },
      { midi: 72, start: 2, dur: 1, velocity: 0.5 },
      { midi: 74, start: 5, dur: 1, velocity: 0.5 },
    ]
    const saida = legato(entrada)
    expect(saida.map((n) => [n.midi, n.start, n.dur])).toEqual([
      [70, 0, 2],
      [72, 2, 3],
      [74, 5, 3],
    ])
    expect(saida.map((n) => n.velocity)).toEqual([0.5, 0.5, 0.5])
  })

  it('não altera a entrada', () => {
    const entrada: NoteEvent[] = [
      { midi: 70, start: 0, dur: 1, velocity: 0.5 },
      { midi: 72, start: 4, dur: 1, velocity: 0.5 },
    ]
    legato(entrada)
    expect(entrada[0]?.dur).toBe(1)
    expect(entrada[1]?.dur).toBe(1)
  })

  it('devolve [] para entrada vazia', () => {
    expect(legato([])).toEqual([])
  })
})

describe('guideToneBar', () => {
  it('usa só 3ª, 7ª ou 9ª do acorde, dentro da tessitura do violino', () => {
    for (const quality of QUALITIES) {
      for (let root = 0; root < 12; root++) {
        const chord: Chord = { root, quality }
        const permitidas = allowedPcs(chord)
        for (const seed of SEEDS) {
          for (const prev of [66, 72, 76]) {
            for (const nota of guideToneBar(chord, prev, createRng(seed + root))) {
              expect(permitidas).toContain(pc(nota.midi))
              expect(nota.midi).toBeGreaterThanOrEqual(VIOLIN_LO)
              expect(nota.midi).toBeLessThanOrEqual(VIOLIN_HI)
            }
          }
        }
      }
    }
  })

  it('tem starts 0 ou 0/4 e a soma das durações é 8', () => {
    for (const quality of QUALITIES) {
      for (const seed of SEEDS) {
        const chord: Chord = { root: 5, quality }
        const barra = guideToneBar(chord, 72, createRng(seed))
        const starts = barra.map((n) => n.start)
        expect([[0], [0, 4]]).toContainEqual(starts)
        const soma = barra.reduce((s, n) => s + n.dur, 0)
        expect(soma).toBe(8)
      }
    }
  })

  it('a 1ª nota fica a no máximo 6 semitons de prevMidi quando ele está no meio da faixa', () => {
    for (const quality of QUALITIES) {
      for (let root = 0; root < 12; root++) {
        const chord: Chord = { root, quality }
        for (const seed of SEEDS) {
          const primeira = guideToneBar(chord, 72, createRng(seed))[0]
          expect(Math.abs((primeira?.midi ?? 0) - 72)).toBeLessThanOrEqual(6)
        }
      }
    }
  })

  it('é determinística com a mesma seed', () => {
    for (const quality of QUALITIES) {
      for (const seed of SEEDS) {
        const chord: Chord = { root: 2, quality }
        const a = guideToneBar(chord, 70, createRng(seed))
        const b = guideToneBar(chord, 70, createRng(seed))
        expect(a).toEqual(b)
      }
    }
  })
})

describe('pickViolinRole', () => {
  it('sorteia lead com probabilidade próxima de 0.5', () => {
    const rng = createRng(2024)
    let lead = 0
    const total = 4000
    for (let i = 0; i < total; i++) {
      if (pickViolinRole(rng) === 'lead') lead++
    }
    expect(Math.abs(lead / total - 0.5)).toBeLessThanOrEqual(0.04)
  })
})
