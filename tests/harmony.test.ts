import { describe, expect, it } from 'vitest'
import { createRng } from '../src/lib/prng'
import { HarmonyGenerator } from '../src/audio/music/harmony/harmonyGenerator'
import { PROGRESSIONS, type ProgBar, type ProgTemplate } from '../src/audio/music/harmony/progressions'
import type { HarmonyStep } from '../src/audio/music/harmony/types'

const VALID_QUALITIES = ['maj7', 'm7', '7', 'm7b5']

function generate(seed: number, bars: number): HarmonyStep[] {
  const gen = new HarmonyGenerator(createRng(seed))
  const steps: HarmonyStep[] = []
  for (let i = 0; i < bars; i++) steps.push(gen.next())
  return steps
}

/** Template e compasso de referência de um passo; lança erro se não existirem. */
function referenceBar(step: HarmonyStep): { tpl: ProgTemplate; bar: ProgBar } {
  const tpl = PROGRESSIONS.find((p) => p.name === step.progName)
  if (!tpl) throw new Error(`progressão desconhecida: ${step.progName}`)
  const bar = tpl.bars[step.barInProg]
  if (!bar) throw new Error(`compasso ${step.barInProg} inexistente em ${step.progName}`)
  return { tpl, bar }
}

describe('biblioteca de progressões', () => {
  it('tem 7 progressões, todas com 4 compassos e peso positivo', () => {
    expect(PROGRESSIONS).toHaveLength(7)
    for (const p of PROGRESSIONS) {
      expect(p.bars).toHaveLength(4)
      expect(p.weight).toBeGreaterThan(0)
    }
  })
})

describe('HarmonyGenerator', () => {
  it('é determinístico por seed', () => {
    expect(generate(12345, 100)).toEqual(generate(12345, 100))
    expect(generate(1, 100)).not.toEqual(generate(2, 100))
  })

  it('organiza em ciclos de 4 compassos, com barInProg sequencial e progressão fixa no ciclo', () => {
    const steps = generate(7, 80)
    let cycleName = ''
    steps.forEach((s, i) => {
      expect(s.progLength).toBe(4)
      expect(s.barInProg).toBe(i % 4)
      if (s.barInProg === 0) cycleName = s.progName
      expect(s.progName).toBe(cycleName)
    })
  })

  it('gera qualidades válidas', () => {
    for (const s of generate(99, 200)) {
      expect(VALID_QUALITIES).toContain(s.chord.quality)
    }
  })

  it('o primeiro compasso nunca tem keyChanged (vale para várias seeds)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const [first] = generate(seed, 1)
      expect(first?.keyChanged).toBe(false)
    }
  })

  it('em 400 compassos: ≥ 3 progressões distintas e ≥ 2 mudanças de tonalidade', () => {
    const steps = generate(2024, 400)
    const names = new Set(steps.map((s) => s.progName))
    expect(names.size).toBeGreaterThanOrEqual(3)
    expect(steps.filter((s) => s.keyChanged).length).toBeGreaterThanOrEqual(2)
  })

  it('keyChanged só ocorre no início de ciclo e a tônica muda de fato', () => {
    const steps = generate(31, 400)
    steps.forEach((s, i) => {
      if (i === 0) return
      const prevKey = steps[i - 1]?.key
      if (s.keyChanged) {
        expect(s.barInProg).toBe(0)
        expect(s.key).not.toBe(prevKey)
      } else if (s.barInProg !== 0) {
        // dentro de um ciclo a tônica não muda
        expect(s.key).toBe(prevKey)
      }
    })
  })

  it('chord.root, qualidade e modo são coerentes com o template (root = (key + deg) % 12)', () => {
    for (const s of generate(555, 400)) {
      const { tpl, bar } = referenceBar(s)
      expect(s.mode).toBe(tpl.mode)
      expect(s.chord.root).toBe((s.key + bar.deg) % 12)
      expect(s.chord.quality).toBe(bar.quality)
    }
  })
})
