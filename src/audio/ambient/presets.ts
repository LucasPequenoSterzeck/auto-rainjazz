import type { AmbientKind } from '../../app/types'

/** Intensidade da chuva gravada. */
export type RainIntensity = 'light' | 'heavy'

/** Excursão máxima do LFO que varre o passa-baixas (Hz). A faixa real vem de lfo.amplitude. */
export const LFO_SPAN_HZ = 400

export interface Preset {
  /** Gravação de chuva usada ('none' = nenhuma). */
  bed: 'none' | RainIntensity
  /** Ganho da gravação de chuva. */
  bedGain: number
  /** Ganho do ruído marrom (brisa). */
  brownGain: number
  /** Faixa do passa-baixas [min, max] em Hz. */
  lpHz: readonly [number, number]
  /** Ganho do ruído rosa (médio agudo). */
  pinkGain: number
  /** Frequência central do passa-faixa do ruído rosa (Hz). */
  bpHz: number
}

/**
 * Chuva = gravação real em loop, sem camadas sintéticas por cima (duas tentativas de
 * chuva procedural foram reprovadas pelo usuário). Brisa continua sintetizada.
 * As duas gravações estão normalizadas para ~-23 dB de média.
 */
export const PRESETS: Record<AmbientKind, Preset> = {
  none: {
    bed: 'none',
    bedGain: 0,
    brownGain: 0,
    lpHz: [300, 600],
    pinkGain: 0,
    bpHz: 3000,
  },
  wind: {
    bed: 'none',
    bedGain: 0,
    brownGain: 0.55,
    lpHz: [220, 900],
    pinkGain: 0.05,
    bpHz: 1200,
  },
  lightRain: {
    bed: 'light',
    bedGain: 0.8,
    brownGain: 0,
    lpHz: [300, 500],
    pinkGain: 0,
    bpHz: 3000,
  },
  rain: {
    bed: 'heavy',
    bedGain: 0.9,
    brownGain: 0,
    lpHz: [300, 600],
    pinkGain: 0,
    bpHz: 3000,
  },
}

/** Centro da faixa do passa-baixas (Hz). */
export const centerOf = (range: readonly [number, number]): number => (range[0] + range[1]) / 2

/** Amplitude normalizada do LFO que cobre metade da faixa. */
export const depthOf = (range: readonly [number, number]): number =>
  (range[1] - range[0]) / 2 / LFO_SPAN_HZ
