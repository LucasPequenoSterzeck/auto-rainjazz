import { describe, expect, it } from 'vitest'
import { createRng } from '../src/lib/prng'
import { makeSeamlessLoop } from '../src/audio/ambient/dsp'

const SR = 8000
const CROSSFADE_S = 0.5
const F = CROSSFADE_S * SR

/** Senoide de `n` amostras (sinal liso: qualquer emenda apareceria como salto). */
function sine(n: number, hz: number, phase = 0): Float32Array {
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * hz * i) / SR + phase)
  return x
}

/** Ruído branco determinístico. */
function noise(n: number, seed: number): Float32Array {
  const rng = createRng(seed)
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = rng.next() * 2 - 1
  return x
}

function rms(x: Float32Array): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / x.length)
}

describe('makeSeamlessLoop', () => {
  it('devolve um canal por canal de entrada, com comprimento = entrada − crossfade', () => {
    const input = [noise(3 * SR, 1), noise(3 * SR, 2)]
    const out = makeSeamlessLoop(input, SR, CROSSFADE_S)
    expect(out).toHaveLength(2)
    expect(out[0]).toHaveLength(3 * SR - F)
    expect(out[1]).toHaveLength(3 * SR - F)
  })

  it('não tem salto na emenda: out[N−1] → out[0] é um passo natural do sinal', () => {
    // 3,1 Hz não fecha um número inteiro de ciclos: um loop ingênuo teria salto.
    const x = sine(3 * SR, 3.1, 0.4)
    const [out] = makeSeamlessLoop([x], SR, CROSSFADE_S)
    const loop = out as Float32Array
    const N = loop.length
    const maxStep = (2 * Math.PI * 3.1) / SR
    expect(Math.abs((loop[0] as number) - (loop[N - 1] as number))).toBeLessThanOrEqual(maxStep * 1.01)
    // Sem a emenda, o salto seria grande.
    expect(Math.abs((x[0] as number) - (x[N - 1] as number))).toBeGreaterThan(maxStep * 10)
  })

  it('fora do crossfade, copia a entrada sem alterar', () => {
    const x = noise(2 * SR, 7)
    const [out] = makeSeamlessLoop([x], SR, CROSSFADE_S)
    const loop = out as Float32Array
    let diferentes = 0
    for (let i = F; i < loop.length; i++) if (loop[i] !== x[i]) diferentes++
    expect(diferentes).toBe(0)
  })

  it('mantém o nível de um ruído (potência igual) dentro do crossfade', () => {
    const x = noise(4 * SR, 11)
    const [out] = makeSeamlessLoop([x], SR, CROSSFADE_S)
    const fadeRms = rms((out as Float32Array).subarray(0, F))
    expect(fadeRms / rms(x)).toBeGreaterThan(0.9)
    expect(fadeRms / rms(x)).toBeLessThan(1.1)
  })

  it('não altera a entrada', () => {
    const x = noise(SR, 3)
    const copia = Float32Array.from(x)
    makeSeamlessLoop([x], SR, CROSSFADE_S)
    expect(Array.from(x)).toEqual(Array.from(copia))
  })

  it('limita o crossfade à metade do trecho', () => {
    const [out] = makeSeamlessLoop([noise(100, 5)], SR, 10)
    expect(out).toHaveLength(50)
  })
})
