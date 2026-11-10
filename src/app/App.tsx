import { useStore } from './store'
import type { AmbientKind, MusicKind, SleepMin } from './types'
import {
  newSeed,
  pause,
  play,
  setAmbient,
  setAmbientVolume,
  setMusic,
  setMusicVolume,
  setSleepTimer,
} from '../audio/audioController'

/** Opção de um grupo de escolha única (role="radiogroup"). */
interface Option<T extends string | number> {
  value: T
  label: string
}

const AMBIENT_OPTIONS: readonly Option<AmbientKind>[] = [
  { value: 'none', label: 'Nenhum' },
  { value: 'wind', label: 'Brisa' },
  { value: 'lightRain', label: 'Chuva leve' },
  { value: 'rain', label: 'Chuva' },
]

const MUSIC_OPTIONS: readonly Option<MusicKind>[] = [
  { value: 'none', label: 'Nenhuma' },
  { value: 'piano', label: 'Piano' },
  { value: 'pianoViolin', label: 'Piano + violino' },
]

const SLEEP_OPTIONS: readonly Option<SleepMin>[] = [
  { value: 0, label: 'Desligado' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '60 min' },
]

const ICON_PLAY = 'M8 5v14l11-7z'
const ICON_PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z'

/**
 * Trata ações assíncronas do controlador. Erros de áudio já são gravados em `error`
 * do store (mostrados em role="alert"); aqui só evitamos promessa rejeitada sem tratamento.
 */
function tratarPromessa(promessa: Promise<void>): void {
  promessa.catch((erro: unknown) => {
    console.error('Falha na ação de áudio:', erro)
  })
}

/** Botão grande Tocar / Pausar. Fica desabilitado enquanto carrega. */
function PlayButton() {
  const playing = useStore((s) => s.playing)
  const loading = useStore((s) => s.loading)

  const rotulo = loading ? 'Carregando…' : playing ? 'Pausar' : 'Tocar'

  const alternar = (): void => {
    if (playing) {
      pause()
    } else {
      tratarPromessa(play())
    }
  }

  return (
    <button
      type="button"
      class={playing ? 'play-button playing' : 'play-button'}
      aria-label={rotulo}
      disabled={loading}
      onClick={alternar}
    >
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d={playing ? ICON_PAUSE : ICON_PLAY} />
      </svg>
      <span>{rotulo}</span>
    </button>
  )
}

interface OptionGroupProps<T extends string | number> {
  /** Nome do grupo de rádios; precisa ser único na página. */
  name: string
  /** id do título que rotula o grupo. */
  labelledBy: string
  options: readonly Option<T>[]
  selected: T
  onSelect: (value: T) => void
}

/** Grupo segmentado de escolha única. Usa rádios nativos (setas do teclado de graça). */
function OptionGroup<T extends string | number>({
  name,
  labelledBy,
  options,
  selected,
  onSelect,
}: OptionGroupProps<T>) {
  return (
    <div class="segmented" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((option) => (
        <label class="option" key={String(option.value)}>
          <input
            class="visually-hidden"
            type="radio"
            name={name}
            value={String(option.value)}
            checked={option.value === selected}
            onChange={() => onSelect(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}

interface VolumeSliderProps {
  id: string
  label: string
  /** 0..1 */
  value: number
  onChange: (value: number) => void
}

/** Slider 0..1 com rótulo visível e valor em porcentagem. */
function VolumeSlider({ id, label, value, onChange }: VolumeSliderProps) {
  const percent = Math.round(value * 100)
  return (
    <div class="slider-row">
      <div class="label-row">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{percent}%</output>
      </div>
      <input
        id={id}
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        aria-valuetext={`${percent}%`}
        style={`--fill: ${percent}%`}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  )
}

/** Painel "Tocando agora": acorde em destaque e detalhes (tonalidade · progressão · BPM). */
function NowPlaying() {
  const nowChord = useStore((s) => s.nowChord)
  const nowKey = useStore((s) => s.nowKey)
  const nowProg = useStore((s) => s.nowProg)
  const bpm = useStore((s) => s.bpm)

  const detalhes = [nowKey, nowProg, bpm > 0 ? `${bpm} BPM` : ''].filter((item) => item !== '')

  return (
    <section class="card" aria-labelledby="title-now-playing">
      <h2 id="title-now-playing">Tocando agora</h2>
      <p class="chord">{nowChord || '—'}</p>
      {detalhes.length > 0 && <p class="details">{detalhes.join(' · ')}</p>}
    </section>
  )
}

/** Tela principal. Lê o estado com useStore e age somente pelo controlador de áudio. */
export function App() {
  const ambient = useStore((s) => s.ambient)
  const music = useStore((s) => s.music)
  const sleepMin = useStore((s) => s.sleepMin)
  const ambientVol = useStore((s) => s.ambientVol)
  const musicVol = useStore((s) => s.musicVol)
  const error = useStore((s) => s.error)

  return (
    <main class="app">
      <header class="header">
        <h1>Auto Rainjazz</h1>
        <p class="subtitle">Jazz suave gerado em tempo real, com chuva ao fundo.</p>
      </header>

      <PlayButton />

      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}

      <section class="card" aria-labelledby="title-ambient">
        <h2 id="title-ambient">Ambiente</h2>
        <OptionGroup
          name="ambient"
          labelledBy="title-ambient"
          options={AMBIENT_OPTIONS}
          selected={ambient}
          onSelect={setAmbient}
        />
      </section>

      <section class="card" aria-labelledby="title-music">
        <h2 id="title-music">Música</h2>
        <OptionGroup
          name="music"
          labelledBy="title-music"
          options={MUSIC_OPTIONS}
          selected={music}
          onSelect={(value) => tratarPromessa(setMusic(value))}
        />
      </section>

      <section class="card" aria-labelledby="title-volumes">
        <h2 id="title-volumes">Volumes</h2>
        <VolumeSlider
          id="ambient-volume"
          label="Volume do ambiente"
          value={ambientVol}
          onChange={setAmbientVolume}
        />
        <VolumeSlider
          id="music-volume"
          label="Volume da música"
          value={musicVol}
          onChange={setMusicVolume}
        />
      </section>

      <section class="card" aria-labelledby="title-sleep">
        <h2 id="title-sleep">Timer de sono</h2>
        <OptionGroup
          name="sleep"
          labelledBy="title-sleep"
          options={SLEEP_OPTIONS}
          selected={sleepMin}
          onSelect={setSleepTimer}
        />
      </section>

      <div class="actions">
        <button
          type="button"
          class="secondary-button"
          aria-describedby="seed-hint"
          onClick={() => tratarPromessa(newSeed())}
        >
          Nova semente
        </button>
        <p id="seed-hint" class="hint">
          Recomeça com outro tom e outra progressão.
        </p>
      </div>

      <NowPlaying />
    </main>
  )
}
