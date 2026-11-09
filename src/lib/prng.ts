/** Gerador pseudoaleatório com seed (mulberry32). Mesma seed => mesma sequência. */
export interface Rng {
  /** Float em [0, 1). */
  next(): number
  /** Inteiro em [min, max], ambos inclusivos. */
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  /** true com probabilidade p (0..1). */
  chance(p: number): boolean
  /** Sorteio ponderado; weights tem o mesmo tamanho de items. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T
}

export function createRng(seed: number): Rng {
  let a = seed | 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
    chance: (p) => next() < p,
    weighted: <T>(items: readonly T[], weights: readonly number[]): T => {
      const total = weights.reduce((s, w) => s + w, 0)
      let r = next() * total
      for (let i = 0; i < items.length; i++) {
        r -= weights[i] as number
        if (r < 0) return items[i] as T
      }
      return items[items.length - 1] as T
    },
  }
}
