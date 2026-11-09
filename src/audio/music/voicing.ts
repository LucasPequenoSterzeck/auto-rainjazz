import { SHELL, type Chord } from './theory/chords'
import { nearestMidi, pc } from './theory/notes'

/** Voicing de um acorde: baixo + 3 notas (3ª, 7ª e extensão), em MIDI. */
export interface Voicing {
  /** Baixo (fundamental), MIDI em [36, 50]. */
  bass: number
  /** 3 notas MIDI em ordem crescente. */
  notes: number[]
}

const BASS_LO = 36
const BASS_HI = 50
const BASS_TARGET = 42

/** Faixa do primeiro `lo` de empilhamento. */
const LO_MIN = 50
const LO_MAX = 62
/** Nota mais aguda permitida. */
const TOP_MAX = 76
/** Intervalo mínimo (semitons) entre notas adjacentes. */
const MIN_ADJACENT = 2
/** Centro de referência quando não há voicing anterior. */
const CENTER = 62

/** Menor MIDI >= `min` com a pitch class `p`. */
const firstAtOrAbove = (p: number, min: number): number => min + pc(p - min)

/**
 * Empilha as pitch classes na ordem dada, em MIDI crescentes a partir de `lo`.
 * Cada nota é a menor MIDI maior que a anterior com aquela pitch class.
 * Retorna null se o candidato for inválido (topo acima de TOP_MAX ou adjacentes < MIN_ADJACENT).
 */
function stack(order: readonly number[], lo: number): number[] | null {
  const notes: number[] = []
  let min = lo
  for (const p of order) {
    const midi = firstAtOrAbove(p, min)
    notes.push(midi)
    min = midi + 1
  }

  if ((notes[notes.length - 1] as number) > TOP_MAX) return null
  for (let i = 1; i < notes.length; i++) {
    if ((notes[i] as number) - (notes[i - 1] as number) < MIN_ADJACENT) return null
  }
  return notes
}

/** Custo de um candidato: movimento total das vozes se há `prev`, senão distância do centro. */
function cost(notes: readonly number[], prev: Voicing | null): number {
  if (prev !== null) {
    let total = 0
    for (let i = 0; i < notes.length; i++) {
      total += Math.abs((notes[i] as number) - (prev.notes[i] as number))
    }
    return total
  }
  const mean = notes.reduce((sum, n) => sum + n, 0) / notes.length
  return Math.abs(mean - CENTER)
}

/**
 * Voicing "shell" do acorde (3ª, 7ª e `extInterval`), escolhido por voice leading:
 * entre os candidatos válidos, o de menor custo (empate: o primeiro encontrado).
 */
export function voiceChord(chord: Chord, prev: Voicing | null, extInterval: number): Voicing {
  const shell = SHELL[chord.quality]
  const pcs = [shell.third, shell.seventh, extInterval].map((iv) => pc(chord.root + iv))
  const bass = nearestMidi(pc(chord.root), BASS_TARGET, BASS_LO, BASS_HI)

  let best: number[] | null = null
  let bestCost = Infinity
  // Rotações: qual das 3 pitch classes fica embaixo.
  for (let r = 0; r < pcs.length; r++) {
    const order = [...pcs.slice(r), ...pcs.slice(0, r)]
    for (let lo = LO_MIN; lo <= LO_MAX; lo++) {
      const notes = stack(order, lo)
      if (notes === null) continue
      const c = cost(notes, prev)
      if (c < bestCost) {
        best = notes
        bestCost = c
      }
    }
  }

  if (best === null) {
    throw new Error(`voiceChord: nenhum voicing válido para ${chord.quality}`)
  }
  return { bass, notes: best }
}
