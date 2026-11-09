/**
 * Funções puras do ambiente sonoro (chuva/brisa). Sem Tone.js e sem DOM,
 * para serem testáveis em Node.
 */

/** Duração de um impacto de gota (tick), em segundos. */
export const DROP_SECONDS = 0.06
/** Fade-out linear no fim da gota, em segundos. */
const DROP_FADE_OUT_S = 0.005

/** Intensidade do loop de chuva. */
export type RainIntensity = 'light' | 'heavy'

/** Loop de chuva estéreo: mesmo comprimento nos dois canais. */
export interface RainBed {
  left: Float32Array
  right: Float32Array
}

interface RainParams {
  /** Corte inferior do chiado (Hz). */
  hpHz: number
  /** Corte superior do chiado (Hz). */
  lpHz: number
  /** Ganho do chiado. */
  hissGain: number
  /** Ganho da camada grave (ruído passa-baixas em BODY_HZ). */
  bodyGain: number
  /** Impactos por segundo. */
  dropRate: number
  /** Amplitude máxima dos impactos. */
  dropAmp: number
  /** Faixa da constante de decaimento de cada impacto (ms). */
  tauMinMs: number
  tauMaxMs: number
}

const RAIN_PARAMS: Record<RainIntensity, RainParams> = {
  light: {
    hpHz: 900,
    lpHz: 7500,
    hissGain: 0.35,
    bodyGain: 0,
    dropRate: 140,
    dropAmp: 0.5,
    tauMinMs: 0.8,
    tauMaxMs: 2.5,
  },
  heavy: {
    hpHz: 500,
    lpHz: 9000,
    hissGain: 0.5,
    bodyGain: 0.25,
    dropRate: 450,
    dropAmp: 0.55,
    tauMinMs: 0.8,
    tauMaxMs: 3.0,
  },
}

/** Corte da camada grave do loop de chuva (Hz). */
const BODY_HZ = 400
/** Duração de cada microimpacto (s). */
const IMPACT_SECONDS = 0.02
/** Crossfade de potência igual no fechamento do loop (s). */
const CROSSFADE_S = 0.5
/** RMS alvo do loop antes do soft-clip. */
const BED_TARGET_RMS = 0.12
/** Ganho do soft-clip. */
const SOFT_CLIP_K = 1.2

/**
 * Sorteio de Poisson (método de Knuth): número de eventos em um intervalo
 * com taxa média `lambda`. Usado para as gotas por tique do agendador.
 * Pressupõe lambda <= 10. Com lambda <= 0 devolve 0.
 */
export function poisson(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0
  const limit = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rand()
  } while (p > limit)
  return k - 1
}

/**
 * Amostras mono de um impacto de gota (tick): quase só ruído branco, com um
 * tom discreto de 900 a 2600 Hz, decaimento exponencial (constante de 4 a 9 ms)
 * e fade-out linear nos últimos 5 ms. Os valores ficam em [-1, 1].
 */
export function makeDropData(sampleRate: number, rand: () => number): Float32Array {
  const length = Math.round(DROP_SECONDS * sampleRate)
  const fadeLen = Math.max(1, Math.round(DROP_FADE_OUT_S * sampleRate))
  const f = 900 + rand() * 1700
  const tau = 0.004 + rand() * 0.005
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    let x = ((rand() * 2 - 1) * 0.65 + Math.sin(2 * Math.PI * f * t) * 0.35) * Math.exp(-t / tau)
    const remaining = length - i
    if (remaining <= fadeLen) x *= remaining / fadeLen
    out[i] = x
  }
  return out
}

/** Coeficiente de um filtro de um polo `y += a*(x-y)` com corte `fc` (Hz). */
function onePoleCoef(fc: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * fc) / sampleRate)
}

/** Soft-clip normalizado: 1 em |v| = 1. Garante |x| <= 1 com um clamp final. */
function softClip(v: number, norm: number): number {
  const y = Math.tanh(v * SOFT_CLIP_K) / norm
  return y > 1 ? 1 : y < -1 ? -1 : y
}

/**
 * Loop de chuva estéreo, sem emenda, com `seconds` de duração.
 *
 * Renderiza `N + F` amostras (N = seconds*sr, F = CROSSFADE_S*sr). No início
 * do loop, a cauda `x[N..N+F)` é misturada com potência igual ao começo `x[0..F)`,
 * então `out[0] = x[N]` continua `out[N-1] = x[N-1]` sem emenda. A modulação
 * de intensidade tem período exato N/sr, então a cauda e o início são coerentes.
 */
export function makeRainBed(
  sampleRate: number,
  seconds: number,
  intensity: RainIntensity,
  rand: () => number,
): RainBed {
  const p = RAIN_PARAMS[intensity]
  const N = Math.round(seconds * sampleRate)
  const F = Math.round(CROSSFADE_S * sampleRate)
  const T = N + F
  const left = new Float32Array(T)
  const right = new Float32Array(T)

  // 1) Chiado decorrelacionado: ruído branco independente por canal, banda LP(lpHz) - LP(hpHz).
  const aHi = onePoleCoef(p.lpHz, sampleRate)
  const aLo = onePoleCoef(p.hpHz, sampleRate)
  const aBody = onePoleCoef(BODY_HZ, sampleRate)
  for (const out of [left, right]) {
    let yHi = 0
    let yLo = 0
    let yBody = 0
    for (let i = 0; i < T; i++) {
      const x = rand() * 2 - 1
      yHi += aHi * (x - yHi)
      yLo += aLo * (x - yLo)
      yBody += aBody * (x - yBody)
      out[i] = (yHi - yLo + p.bodyGain * yBody) * p.hissGain
    }
  }

  // 2) Ondulação lenta de intensidade. Frequências inteiras por ciclo do loop
  // ⇒ periódica com período N/sr.
  const loopS = N / sampleRate
  const phi1 = rand() * 2 * Math.PI
  const phi2 = rand() * 2 * Math.PI
  for (let i = 0; i < T; i++) {
    const t = i / sampleRate
    const m =
      1 +
      0.12 * Math.sin((2 * Math.PI * 3 * t) / loopS + phi1) +
      0.08 * Math.sin((2 * Math.PI * 7 * t) / loopS + phi2)
    left[i] *= m
    right[i] *= m
  }

  // 3) Microimpactos: muitos fracos, poucos fortes; cada um com pan aleatório.
  const count = Math.round((p.dropRate * T) / sampleRate)
  const impactLen = Math.round(IMPACT_SECONDS * sampleRate)
  for (let k = 0; k < count; k++) {
    const start = Math.floor(rand() * T)
    const amp = p.dropAmp * rand() ** 2.5
    const tau = (p.tauMinMs + rand() * (p.tauMaxMs - p.tauMinMs)) / 1000
    const decay = 1 / (tau * sampleRate)
    const theta = rand() * (Math.PI / 2)
    const gL = amp * Math.cos(theta)
    const gR = amp * Math.sin(theta)
    const len = Math.min(impactLen, T - start)
    let prev = 0
    for (let n = 0; n < len; n++) {
      const cur = (rand() * 2 - 1) * Math.exp(-n * decay)
      // Primeira diferença: clique mais brilhante.
      const d = (cur - prev) * 0.7
      prev = cur
      left[start + n] += gL * d
      right[start + n] += gR * d
    }
  }

  // 4) Crossfade de potência igual: o início mistura a cauda x[N..N+F) (fade-out)
  // com x[0..F) (fade-in). Fora disso, out = x.
  const outL = new Float32Array(N)
  const outR = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    if (i < F) {
      const w = i / F
      const wIn = Math.sqrt(w)
      const wOut = Math.sqrt(1 - w)
      outL[i] = left[i] * wIn + left[N + i] * wOut
      outR[i] = right[i] * wIn + right[N + i] * wOut
    } else {
      outL[i] = left[i]
      outR[i] = right[i]
    }
  }

  // 5) Normalização de RMS global (L e R juntos) e soft-clip.
  let sum = 0
  for (let i = 0; i < N; i++) sum += outL[i] * outL[i] + outR[i] * outR[i]
  const rms = Math.sqrt(sum / (2 * N))
  const gain = rms > 0 ? BED_TARGET_RMS / rms : 0
  const norm = Math.tanh(SOFT_CLIP_K)
  for (let i = 0; i < N; i++) {
    outL[i] = softClip(outL[i] * gain, norm)
    outR[i] = softClip(outR[i] * gain, norm)
  }
  return { left: outL, right: outR }
}
