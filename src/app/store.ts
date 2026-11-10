import { createStore } from 'zustand/vanilla'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useEffect, useState } from 'preact/hooks'
import type { AmbientKind, MusicKind, SleepMin } from './types'

export interface AppState {
  playing: boolean
  /** true enquanto baixa os samples / inicia o áudio. */
  loading: boolean
  error?: string
  ambient: AmbientKind
  music: MusicKind
  /** 0..1 */
  ambientVol: number
  /** 0..1 */
  musicVol: number
  seed: number
  sleepMin: SleepMin
  /** Exibição: acorde atual, ex. "Dm7". */
  nowChord: string
  /** Exibição: tonalidade, ex. "Dó maior"/"E♭ menor". */
  nowKey: string
  /** Exibição: progressão, ex. "ii–V–I". */
  nowProg: string
  bpm: number
}

/** Preferências guardadas no navegador entre visitas. */
type Prefs = Pick<AppState, 'ambient' | 'music' | 'ambientVol' | 'musicVol' | 'sleepMin'>

const AMBIENTS: readonly AmbientKind[] = ['none', 'wind', 'lightRain', 'rain']
const MUSICS: readonly MusicKind[] = ['none', 'piano', 'pianoViolin']
const SLEEPS: readonly SleepMin[] = [0, 15, 30, 60]

/** `value` se for um dos `allowed`; senão `fallback`. */
function oneOf<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback
}

/** Volume salvo válido (0..1) ou `fallback`. */
function volumeOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
}

/** Aplica as preferências salvas sobre o estado inicial, descartando valores inválidos ou antigos. */
function mergePrefs(saved: unknown, initial: AppState): AppState {
  if (typeof saved !== 'object' || saved === null) return initial
  const s = saved as Record<string, unknown>
  return {
    ...initial,
    ambient: oneOf(AMBIENTS, s.ambient, initial.ambient),
    music: oneOf(MUSICS, s.music, initial.music),
    ambientVol: volumeOr(s.ambientVol, initial.ambientVol),
    musicVol: volumeOr(s.musicVol, initial.musicVol),
    sleepMin: oneOf(SLEEPS, s.sleepMin, initial.sleepMin),
  }
}

export const store = createStore<AppState>()(
  persist(
    () => ({
      playing: false,
      loading: false,
      error: undefined,
      ambient: 'lightRain' as AmbientKind,
      music: 'piano' as MusicKind,
      ambientVol: 0.3,
      musicVol: 0.6,
      seed: Math.floor(Math.random() * 2 ** 32),
      sleepMin: 0 as SleepMin,
      nowChord: '',
      nowKey: '',
      nowProg: '',
      bpm: 0,
    }),
    {
      name: 'auto-rainjazz:prefs',
      version: 1,
      // Sem localStorage (modo privado, bloqueado), o app funciona normalmente, só não lembra.
      storage: createJSONStorage(() => localStorage),
      partialize: (s): Prefs => ({
        ambient: s.ambient,
        music: s.music,
        ambientVol: s.ambientVol,
        musicVol: s.musicVol,
        sleepMin: s.sleepMin,
      }),
      merge: mergePrefs,
    },
  ),
)

/** Hook mínimo para Preact (evita precisar do preact/compat). */
export function useStore<T>(selector: (s: AppState) => T): T {
  const [value, setValue] = useState<T>(() => selector(store.getState()))
  useEffect(() => {
    setValue(() => selector(store.getState()))
    return store.subscribe((s) => setValue(() => selector(s)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return value
}
