const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] as const

/** Pitch class (0..11), seguro para negativos. */
export const pc = (n: number): number => ((n % 12) + 12) % 12

/** MIDI -> nome com oitava para o Tone.js (ex.: 60 -> "C4", 61 -> "C#4"). */
export const midiToName = (midi: number): string =>
  `${SHARP_NAMES[pc(midi)]}${Math.floor(midi / 12) - 1}`

/** Nome de exibição da nota (bemóis, estilo jazz). */
export const pcName = (p: number): string => FLAT_NAMES[pc(p)] as string

/**
 * Nota MIDI com a pitch class `pitchClass`, dentro de [lo, hi], mais próxima de `target`.
 * Requer hi - lo >= 11.
 */
export function nearestMidi(pitchClass: number, target: number, lo: number, hi: number): number {
  let best = lo
  let bestDist = Infinity
  for (let m = lo; m <= hi; m++) {
    if (pc(m) !== pc(pitchClass)) continue
    const d = Math.abs(m - target)
    if (d < bestDist) {
      best = m
      bestDist = d
    }
  }
  return best
}
