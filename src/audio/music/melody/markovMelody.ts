import { createRng, type Rng } from '../../../lib/prng'
import { chordPitchClasses, melodyClassOf, type MelodyClass } from '../theory/chords'
import { nearestMidi, pc } from '../theory/notes'
import { CORPUS } from './corpus'
import { UNITS_PER_BAR, type BarContext, type MelodyGenerator, type NoteEvent } from './types'

/** Opções do gerador (todas opcionais). */
export interface MarkovOptions {
  /** Probabilidade de o compasso sair vazio (só harmonia). Padrão 0.22. */
  restBarProb?: number
  /** Probabilidade de usar ordem 1 em vez de ordem 2 a cada token. Padrão 0.35. */
  order1Mix?: number
  /** Pesos = count ** (1 / temperature); deve ser > 0. Padrão 1.0. */
  temperature?: number
}

/** Marcadores de início e fim de frase. */
const BOS = '^'
const EOS = '$'
const REST = 'r'

/** Faixa de altura da linha melódica (MIDI) e nota de partida. */
const MIDI_LO = 66
const MIDI_HI = 84
const START_MIDI = 74

/** Distribuição de próximo token: tokens e pesos já aplicados a temperatura. */
interface Dist {
  tokens: string[]
  weights: number[]
}

/** Transições de uma classe de acorde: chave de ordem 1 (`b`) e de ordem 2 (`a|b`). */
interface ClassModel {
  order1: Map<string, Dist>
  order2: Map<string, Dist>
}

interface ParsedToken {
  rest: boolean
  /** Semitons acima da fundamental (relativo ao acorde). */
  pc: number
  dur: number
}

function parseToken(token: string): ParsedToken {
  const [head, durText] = token.split(':')
  const dur = Number(durText)
  return head === REST ? { rest: true, pc: 0, dur } : { rest: false, pc: Number(head), dur }
}

/** Distância circular entre duas pitch classes (0..6). */
function pcDistance(a: number, b: number): number {
  const d = Math.abs(a - b)
  return Math.min(d, 12 - d)
}

/**
 * Nota do acorde (pitch class absoluta) de menor distância circular a `abs`.
 * Empate: a primeira na ordem de `chordPcs`.
 */
function nearestChordPc(abs: number, chordPcs: readonly number[]): number {
  let best = abs
  let bestDist = Infinity
  for (const c of chordPcs) {
    const d = pcDistance(abs, c)
    if (d < bestDist) {
      best = c
      bestDist = d
    }
  }
  return best
}

/** Converte contagens em distribuições, aplicando `count ** (1/temperature)`. */
function toDists(table: Map<string, Map<string, number>>, temperature: number): Map<string, Dist> {
  const out = new Map<string, Dist>()
  for (const [key, inner] of table) {
    const tokens: string[] = []
    const weights: number[] = []
    for (const [token, count] of inner) {
      tokens.push(token)
      weights.push(count ** (1 / temperature))
    }
    out.set(key, { tokens, weights })
  }
  return out
}

/** Treina o modelo de uma classe de acorde a partir do corpus. */
function trainClass(cls: MelodyClass, temperature: number): ClassModel {
  const counts1 = new Map<string, Map<string, number>>()
  const counts2 = new Map<string, Map<string, number>>()
  const addCount = (table: Map<string, Map<string, number>>, key: string, next: string): void => {
    const inner = table.get(key) ?? new Map<string, number>()
    inner.set(next, (inner.get(next) ?? 0) + 1)
    table.set(key, inner)
  }
  for (const phrase of CORPUS[cls]) {
    const seq = [BOS, ...phrase.split(' '), EOS]
    // Começa em 1 para que o primeiro token seja previsto a partir de "^|^", igual à geração.
    for (let i = 1; i < seq.length; i++) {
      const next = seq[i] as string
      const prev1 = seq[i - 1] as string
      const prev2 = i >= 2 ? (seq[i - 2] as string) : BOS
      addCount(counts1, prev1, next)
      addCount(counts2, `${prev2}|${prev1}`, next)
    }
  }
  return { order1: toDists(counts1, temperature), order2: toDists(counts2, temperature) }
}

/** Melodia por cadeias de Markov de ordem 2 (com fallback de ordem 1) sobre frases do corpus. */
export class MarkovMelody implements MelodyGenerator {
  private rng: Rng
  private last = START_MIDI
  private readonly restBarProb: number
  private readonly order1Mix: number
  private readonly models: Record<MelodyClass, ClassModel>

  constructor(rng: Rng, opts: MarkovOptions = {}) {
    this.rng = rng
    this.restBarProb = opts.restBarProb ?? 0.22
    this.order1Mix = opts.order1Mix ?? 0.35
    const temperature = opts.temperature ?? 1.0
    this.models = {
      maj: trainClass('maj', temperature),
      min: trainClass('min', temperature),
      dom: trainClass('dom', temperature),
    }
  }

  nextBar(ctx: BarContext): NoteEvent[] {
    const { rng } = this
    // 1. Compasso só de harmonia.
    if (rng.chance(this.restBarProb)) return []

    const { chord } = ctx
    // 2. Contexto inicial e classe do acorde.
    const model = this.models[melodyClassOf(chord.quality)]
    const chordPcs = chordPitchClasses(chord)
    const events: NoteEvent[] = []
    let prev2 = BOS
    let prev1 = BOS
    let pos = 0

    while (pos < UNITS_PER_BAR) {
      // 3. Ordem 2 com prob. 1 - order1Mix, se a chave existir; senão ordem 1.
      const useOrder2 = rng.chance(1 - this.order1Mix)
      const dist =
        (useOrder2 ? model.order2.get(`${prev2}|${prev1}`) : undefined) ?? model.order1.get(prev1)
      if (!dist) break
      const token = rng.weighted(dist.tokens, dist.weights)
      if (token === EOS) break
      prev2 = prev1
      prev1 = token

      const parsed = parseToken(token)
      const start = pos
      const dur = Math.min(parsed.dur, UNITS_PER_BAR - pos)
      pos += dur
      if (parsed.rest) continue

      const strong = start === 0 || start === 4

      // 4. Mapeamento para m7b5: a quinta (7) vira quinta diminuta (6) e a sexta (9) vira 8.
      let rel = parsed.pc
      if (chord.quality === 'm7b5') {
        if (rel === 7) rel = 6
        else if (rel === 9) rel = 8
      }
      let abs = pc(chord.root + rel)

      // 5. Tempo forte: se não for nota do acorde, troca pela mais próxima do acorde.
      if (strong && !chordPcs.includes(abs)) abs = nearestChordPc(abs, chordPcs)

      // 6. Altura: a nota com essa pitch class mais próxima da anterior.
      const midi = nearestMidi(abs, this.last, MIDI_LO, MIDI_HI)
      this.last = midi

      // 7. Velocity: base aleatória, reforço nos tempos fortes.
      let velocity = 0.42 + rng.next() * 0.18
      if (strong) velocity += 0.06
      events.push({ midi, start, dur, velocity: Math.min(1, velocity) })
    }
    // 8. Eventos saem em ordem de start, sem sobreposição e com start + dur <= 8.
    return events
  }

  reset(seed: number): void {
    this.rng = createRng(seed)
    this.last = START_MIDI
  }
}
