import type { Rng } from '../../../lib/prng'
import type { HarmonyGen, HarmonyStep } from './types'
import { PROGRESSIONS, type ProgBar, type ProgTemplate } from './progressions'

/** Compassos por ciclo (todas as progressões têm 4). */
const PROG_LENGTH = 4

/** Probabilidade de a tônica mudar ao iniciar um ciclo (a partir do segundo). */
const KEY_CHANGE_PROB = 0.5

/** Intervalos (semitons) possíveis para a nova tônica, relativos à atual. */
const KEY_STEPS = [5, 7, 2, 10, 9, 3]

const PROG_WEIGHTS = PROGRESSIONS.map((p) => p.weight)

/** Gerador de harmonia: sequência infinita de compassos com progressões de jazz. */
export class HarmonyGenerator implements HarmonyGen {
  private readonly rng: Rng
  /** Tônica atual (pitch class 0..11). */
  private key: number
  private template: ProgTemplate | null = null
  /** Índice do próximo compasso dentro do ciclo atual. */
  private barIdx = 0

  constructor(rng: Rng) {
    this.rng = rng
    this.key = rng.int(0, 11)
  }

  next(): HarmonyStep {
    let template = this.template
    let keyChanged = false

    if (template === null || this.barIdx >= PROG_LENGTH) {
      // Início de ciclo: sorteia a progressão e, a partir do segundo ciclo, talvez mude a tônica.
      const isFirstCycle = template === null
      template = this.rng.weighted(PROGRESSIONS, PROG_WEIGHTS)
      this.template = template
      this.barIdx = 0
      if (!isFirstCycle && this.rng.chance(KEY_CHANGE_PROB)) {
        this.key = (this.key + this.rng.pick(KEY_STEPS)) % 12
        keyChanged = true
      }
    }

    const bar = template.bars[this.barIdx] as ProgBar
    const step: HarmonyStep = {
      chord: { root: (this.key + bar.deg) % 12, quality: bar.quality },
      key: this.key,
      mode: template.mode,
      progName: template.name,
      barInProg: this.barIdx,
      progLength: PROG_LENGTH,
      keyChanged,
    }
    this.barIdx++
    return step
  }
}
