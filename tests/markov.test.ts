import { describe, expect, it } from 'vitest'
import { CORPUS } from '../src/audio/music/melody/corpus'
import { MarkovMelody } from '../src/audio/music/melody/markovMelody'
import type { NoteEvent } from '../src/audio/music/melody/types'
import {
  chordPitchClasses,
  type Chord,
  type MelodyClass,
  type Quality,
} from '../src/audio/music/theory/chords'
import { pc } from '../src/audio/music/theory/notes'
import { createRng } from '../src/lib/prng'

const CLASSES: readonly MelodyClass[] = ['maj', 'min', 'dom']
const QUALITIES: readonly Quality[] = ['maj7', 'm7', '7', 'm7b5']
const TOKEN_RE = /^(\d+|r):(\d+)$/

/** Acorde de raiz variada, para cobrir todas as tonalidades. */
const chordAt = (i: number, quality: Quality): Chord => ({ root: (i * 5) % 12, quality })

describe('corpus', () => {
  it('toda frase soma 8 e todo token é válido', () => {
    for (const cls of CLASSES) {
      for (const phrase of CORPUS[cls]) {
        let sum = 0
        for (const tok of phrase.split(' ')) {
          const match = TOKEN_RE.exec(tok)
          if (match === null) throw new Error(`token inválido "${tok}" em "${phrase}"`)
          const [, head, durText] = match
          const isRest = head === 'r'
          const relPc = Number(head)
          const dur = Number(durText)
          expect(isRest || (Number.isInteger(relPc) && relPc >= 0 && relPc <= 11), tok).toBe(true)
          expect(Number.isInteger(dur) && dur >= 1, tok).toBe(true)
          sum += dur
        }
        expect(sum, phrase).toBe(8)
      }
    }
  })
})

describe('determinismo', () => {
  it('mesma seed ⇒ mesma saída em 100 compassos', () => {
    const a = new MarkovMelody(createRng(12345))
    const b = new MarkovMelody(createRng(12345))
    for (let i = 0; i < 100; i++) {
      const chord = chordAt(i, QUALITIES[i % QUALITIES.length] as Quality)
      expect(b.nextBar({ chord, barIndex: i })).toEqual(a.nextBar({ chord, barIndex: i }))
    }
  })
})

describe('invariantes', () => {
  for (const quality of QUALITIES) {
    it(`300 compassos sobre ${quality} respeitam as regras`, () => {
      const gen = new MarkovMelody(createRng(1000 + QUALITIES.indexOf(quality)))
      let lastMidi: number | null = null
      for (let i = 0; i < 300; i++) {
        const chord = chordAt(i, quality)
        const chordPcs = chordPitchClasses(chord)
        const events: NoteEvent[] = gen.nextBar({ chord, barIndex: i })
        let prevEnd = 0
        for (const e of events) {
          const where = `compasso ${i}, nota ${JSON.stringify(e)}`
          expect(e.start >= 0 && e.start <= 7, where).toBe(true)
          expect(e.dur >= 1, where).toBe(true)
          expect(e.start + e.dur <= 8, where).toBe(true)
          expect(e.start >= prevEnd, `sobreposição: ${where}`).toBe(true)
          prevEnd = e.start + e.dur
          expect(e.midi >= 66 && e.midi <= 84, where).toBe(true)
          expect(e.velocity > 0 && e.velocity <= 1, where).toBe(true)
          if (e.start === 0 || e.start === 4) {
            expect(chordPcs.includes(pc(e.midi)), `tempo forte fora do acorde: ${where}`).toBe(true)
          }
          if (lastMidi !== null) {
            expect(Math.abs(e.midi - lastMidi) <= 11, `salto grande: ${where}`).toBe(true)
          }
          lastMidi = e.midi
        }
      }
    })
  }
})

describe('variedade', () => {
  it('200 compassos sobre m7: ≥ 25 padrões distintos e 10%–40% vazios com restBarProb padrão', () => {
    const gen = new MarkovMelody(createRng(42))
    const chord: Chord = { root: 2, quality: 'm7' }
    const signatures = new Set<string>()
    let empty = 0
    for (let i = 0; i < 200; i++) {
      const events = gen.nextBar({ chord, barIndex: i })
      if (events.length === 0) empty++
      signatures.add(events.map((e) => `${e.start}:${e.dur}:${e.midi}`).join(' '))
    }
    expect(signatures.size).toBeGreaterThanOrEqual(25)
    const emptyFrac = empty / 200
    expect(emptyFrac).toBeGreaterThanOrEqual(0.1)
    expect(emptyFrac).toBeLessThanOrEqual(0.4)
  })
})
