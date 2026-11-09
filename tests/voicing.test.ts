import { describe, expect, it } from 'vitest'
import { createRng } from '../src/lib/prng'
import { SHELL, type Chord, type Quality } from '../src/audio/music/theory/chords'
import { pc } from '../src/audio/music/theory/notes'
import { voiceChord, type Voicing } from '../src/audio/music/voicing'

const QUALITIES: readonly Quality[] = ['maj7', 'm7', '7', 'm7b5']

/** Invariantes de um voicing para o acorde dado. */
function expectValid(v: Voicing, chord: Chord, ext: number): void {
  const shell = SHELL[chord.quality]
  const [n0, n1, n2] = v.notes

  expect(v.notes).toHaveLength(3)
  // notas ascendentes
  expect(n1).toBeGreaterThan(n0)
  expect(n2).toBeGreaterThan(n1)
  // contém 3ª, 7ª e extensão
  const pcs = v.notes.map((n) => pc(n))
  expect(pcs).toContain(pc(chord.root + shell.third))
  expect(pcs).toContain(pc(chord.root + shell.seventh))
  expect(pcs).toContain(pc(chord.root + ext))
  // faixa: base >= 50, topo <= 76
  expect(n0).toBeGreaterThanOrEqual(50)
  expect(n2).toBeLessThanOrEqual(76)
  // adjacentes com pelo menos 2 semitons
  expect(n1 - n0).toBeGreaterThanOrEqual(2)
  expect(n2 - n1).toBeGreaterThanOrEqual(2)
  // baixo: pitch class da fundamental, em [36, 50]
  expect(pc(v.bass)).toBe(pc(chord.root))
  expect(v.bass).toBeGreaterThanOrEqual(36)
  expect(v.bass).toBeLessThanOrEqual(50)
}

/** Soma das distâncias voz a voz entre dois voicings (mesma ordem de vozes). */
function totalVoiceMove(a: Voicing, b: Voicing): number {
  return a.notes.reduce((sum, n, k) => sum + Math.abs(n - (b.notes[k] as number)), 0)
}

describe('voiceChord', () => {
  it('500 acordes aleatórios encadeados: invariantes e movimento médio por voz ≤ 4 semitons', () => {
    const rng = createRng(20260101)
    let prev: Voicing | null = null
    let totalMove = 0
    let voiceSteps = 0

    for (let i = 0; i < 500; i++) {
      const chord: Chord = { root: rng.int(0, 11), quality: rng.pick(QUALITIES) }
      const ext = rng.pick(SHELL[chord.quality].ext)
      const v = voiceChord(chord, prev, ext)
      expectValid(v, chord, ext)
      if (prev !== null) {
        totalMove += totalVoiceMove(v, prev)
        voiceSteps += 3
      }
      prev = v
    }

    expect(voiceSteps).toBeGreaterThan(0)
    expect(totalMove / voiceSteps).toBeLessThanOrEqual(4)
  })

  it('sempre há candidato válido para as 4 qualidades, todas as raízes e extensões (com e sem prev)', () => {
    // Anteriores extremos: força o algoritmo a escolher entre candidatos bem distantes.
    const extremePrevs: Voicing[] = [
      { bass: 36, notes: [50, 51, 52] },
      { bass: 50, notes: [74, 75, 76] },
    ]
    for (const quality of QUALITIES) {
      for (const ext of SHELL[quality].ext) {
        for (let root = 0; root < 12; root++) {
          const chord: Chord = { root, quality }
          expectValid(voiceChord(chord, null, ext), chord, ext)
          for (const p of extremePrevs) {
            expectValid(voiceChord(chord, p, ext), chord, ext)
          }
        }
      }
    }
  })

  it('com prev já válido para o mesmo acorde, repete esse voicing (custo zero)', () => {
    for (const quality of QUALITIES) {
      for (const ext of SHELL[quality].ext) {
        for (let root = 0; root < 12; root++) {
          const chord: Chord = { root, quality }
          const v0 = voiceChord(chord, null, ext)
          expect(voiceChord(chord, v0, ext).notes).toEqual(v0.notes)
        }
      }
    }
  })

  it('o baixo é a fundamental mais próxima de 42', () => {
    expect(voiceChord({ root: 6, quality: 'm7' }, null, 2).bass).toBe(42)
    expect(voiceChord({ root: 11, quality: 'maj7' }, null, 2).bass).toBe(47)
  })
})
