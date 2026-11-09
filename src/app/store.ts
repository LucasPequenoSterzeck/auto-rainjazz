import { createStore } from 'zustand/vanilla'
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

export const store = createStore<AppState>(() => ({
  playing: false,
  loading: false,
  error: undefined,
  ambient: 'lightRain',
  music: 'piano',
  ambientVol: 0.3,
  musicVol: 0.6,
  seed: Math.floor(Math.random() * 2 ** 32),
  sleepMin: 0,
  nowChord: '',
  nowKey: '',
  nowProg: '',
  bpm: 0,
}))

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
