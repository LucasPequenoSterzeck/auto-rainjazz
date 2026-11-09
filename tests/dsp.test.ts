import { describe, expect, it } from 'vitest'
import { createRng } from '../src/lib/prng'
import {
  DROP_SECONDS,
  makeDropData,
  makeRainBed,
  poisson,
  type RainBed,
  type RainIntensity,
} from '../src/audio/ambient/dsp'

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

/** Parâmetros dos loops de chuva nos testes: rápidos, mas com as mesmas regras. */
const BED_SR = 24000
const BED_SECONDS = 4

/** RMS de x no intervalo [from, to). */
function rms(x: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += x[i] * x[i]
  return Math.sqrt(sum / (to - from))
}

/** RMS conjunto de L e R. */
function globalRms(bed: RainBed): number {
  let sum = 0
  for (let i = 0; i < bed.left.length; i++) {
    sum += bed.left[i] * bed.left[i] + bed.right[i] * bed.right[i]
  }
  return Math.sqrt(sum / (2 * bed.left.length))
}

/** Correlação de Pearson entre L e R. */
function correlation(a: Float32Array, b: Float32Array): number {
  const n = a.length
  let sa = 0
  let sb = 0
  for (let i = 0; i < n; i++) {
    sa += a[i]
    sb += b[i]
  }
  const ma = sa / n
  const mb = sb / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return num / Math.sqrt(da * db)
}

/** RMS de uma média móvel de `win` amostras de x, dividido pelo RMS total de referência. */
function lowBandRatio(x: Float32Array, win: number, total: number): number {
  let acc = 0
  let sum = 0
  for (let i = 0; i < x.length; i++) {
    sum += x[i]
    if (i >= win) sum -= x[i - win]
    if (i >= win - 1) {
      const mean = sum / win
      acc += mean * mean
    }
  }
  const count = x.length - win + 1
  return Math.sqrt(acc / count) / total
}

/** Gera um loop de chuva com a seed dada. */
function bedWith(intensity: RainIntensity, seed: number): RainBed {
  return makeRainBed(BED_SR, BED_SECONDS, intensity, createRng(seed).next)
}

describe('makeDropData', () => {
  it('tem duração de DROP_SECONDS (60 ms)', () => {
    for (const sr of [44100, 48000]) {
      const rng = createRng(7)
      const data = makeDropData(sr, () => rng.next())
      expect(Math.abs(data.length - DROP_SECONDS * sr)).toBeLessThanOrEqual(1)
    }
  })

  it('valores finitos e |x| <= 1 para várias seeds', () => {
    for (const seed of SEEDS) {
      const rng = createRng(seed)
      const data = makeDropData(48000, () => rng.next())
      for (const x of data) {
        expect(Number.isFinite(x)).toBe(true)
        expect(Math.abs(x)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('energia decai: RMS da 1a metade > RMS da 2a', () => {
    for (const seed of SEEDS) {
      const rng = createRng(seed)
      const data = makeDropData(48000, () => rng.next())
      const half = Math.floor(data.length / 2)
      expect(rms(data, 0, half)).toBeGreaterThan(rms(data, half, data.length))
    }
  })

  it('termina em silêncio (fade-out)', () => {
    const rng = createRng(3)
    const data = makeDropData(48000, () => rng.next())
    expect(Math.abs(data[data.length - 1])).toBeLessThan(1e-3)
  })

  it('é determinística para a mesma seed', () => {
    const a = makeDropData(48000, createRng(42).next)
    const b = makeDropData(48000, createRng(42).next)
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})

describe('makeRainBed', () => {
  const INTENSITIES: RainIntensity[] = ['light', 'heavy']
  const N = Math.round(BED_SECONDS * BED_SR)

  it('L e R têm comprimento round(seconds*sr) e valores finitos com |x| <= 1', () => {
    for (const intensity of INTENSITIES) {
      for (const seed of [1, 7, 99]) {
        const bed = bedWith(intensity, seed)
        expect(bed.left.length).toBe(N)
        expect(bed.right.length).toBe(N)
        // Verificação agregada: um expect por amostra é lento demais.
        let maxAbs = 0
        let finite = true
        for (const x of [bed.left, bed.right]) {
          for (let i = 0; i < x.length; i++) {
            if (!Number.isFinite(x[i])) finite = false
            maxAbs = Math.max(maxAbs, Math.abs(x[i]))
          }
        }
        expect(finite).toBe(true)
        expect(maxAbs).toBeLessThanOrEqual(1)
      }
    }
  })

  it('RMS global (L e R juntos) entre 0.05 e 0.25', () => {
    for (const intensity of INTENSITIES) {
      for (const seed of [1, 7, 99]) {
        const r = globalRms(bedWith(intensity, seed))
        expect(r).toBeGreaterThanOrEqual(0.05)
        expect(r).toBeLessThanOrEqual(0.25)
      }
    }
  })

  it('é determinístico: mesma seed, mesmo conteúdo', () => {
    for (const intensity of INTENSITIES) {
      const a = bedWith(intensity, 7)
      const b = bedWith(intensity, 7)
      expect(Array.from(a.left)).toEqual(Array.from(b.left))
      expect(Array.from(a.right)).toEqual(Array.from(b.right))
    }
  })

  it('estéreo largo: correlação entre L e R < 0.5', () => {
    for (const intensity of INTENSITIES) {
      for (const seed of [1, 7, 99]) {
        const bed = bedWith(intensity, seed)
        expect(correlation(bed.left, bed.right)).toBeLessThan(0.5)
      }
    }
  })

  it('sem emenda: |L[0] - L[N-1]| <= 6 x RMS da primeira diferença de L', () => {
    for (const intensity of INTENSITIES) {
      for (const seed of [1, 7, 99]) {
        const { left } = bedWith(intensity, seed)
        let sum = 0
        for (let i = 1; i < N; i++) {
          const d = left[i] - left[i - 1]
          sum += d * d
        }
        const diffRms = Math.sqrt(sum / (N - 1))
        expect(Math.abs(left[0] - left[N - 1])).toBeLessThanOrEqual(6 * diffRms)
      }
    }
  })

  it('heavy tem mais energia de baixa frequência que light', () => {
    for (const seed of [1, 7, 99]) {
      const light = bedWith('light', seed)
      const heavy = bedWith('heavy', seed)
      const lightLow = lowBandRatio(light.left, 100, globalRms(light))
      const heavyLow = lowBandRatio(heavy.left, 100, globalRms(heavy))
      expect(heavyLow).toBeGreaterThan(lightLow)
    }
  })

  it('não é estático: RMS em janelas de 0.25 s varia mais de 3% (desvio relativo)', () => {
    const win = Math.round(0.25 * BED_SR)
    for (const intensity of INTENSITIES) {
      const { left } = bedWith(intensity, 7)
      const levels: number[] = []
      for (let from = 0; from + win <= N; from += win) levels.push(rms(left, from, from + win))
      const mean = levels.reduce((s, v) => s + v, 0) / levels.length
      const variance = levels.reduce((s, v) => s + (v - mean) * (v - mean), 0) / levels.length
      expect(Math.sqrt(variance) / mean).toBeGreaterThan(0.03)
    }
  })
})

describe('poisson', () => {
  it('com lambda 0 devolve sempre 0', () => {
    const rng = createRng(11)
    for (let i = 0; i < 1000; i++) {
      expect(poisson(0, () => rng.next())).toBe(0)
    }
  })

  it('devolve inteiros não negativos', () => {
    const rng = createRng(12)
    for (let i = 0; i < 1000; i++) {
      const n = poisson(2.4, () => rng.next())
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(0)
    }
  })

  it('média ≈ lambda em 5000 amostras (tolerância 5%)', () => {
    for (const lambda of [2.4, 7]) {
      const rng = createRng(100 + lambda)
      let sum = 0
      const n = 5000
      for (let i = 0; i < n; i++) sum += poisson(lambda, () => rng.next())
      const mean = sum / n
      expect(Math.abs(mean - lambda)).toBeLessThanOrEqual(0.05 * lambda)
    }
  })
})
