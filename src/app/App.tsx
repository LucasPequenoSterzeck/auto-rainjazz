import type { ComponentChildren } from 'preact'
import { useStore } from './store'
import type { AmbientKind, MusicKind, SleepMin } from './types'
import {
  newSeed,
  pause,
  play,
  setAmbient,
  setAmbientVolume,
  setMasterVolume,
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
/** Dado: nova semente. Traço de 2 px, igual ao dos alto-falantes. */
const ICON_DICE = 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z'
const ICON_SPEAKER = 'M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z'
const ICON_WAVE_LOW = 'M15.5 9.5a3.5 3.5 0 0 1 0 5'
const ICON_WAVE_HIGH = 'M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10'

/**
 * Trata ações assíncronas do controlador. Erros de áudio já são gravados em `error`
 * do store (mostrados em role="alert"); aqui só evitamos promessa rejeitada sem tratamento.
 */
function tratarPromessa(promessa: Promise<void>): void {
  promessa.catch((erro: unknown) => {
    console.error('Falha na ação de áudio:', erro)
  })
}

/** Tocar / Pausar. Redondo, só ícone (com rótulo para leitores de tela); desabilitado ao carregar. */
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
      title={rotulo}
      disabled={loading}
      onClick={alternar}
    >
      {loading ? (
        <span class="spinner" aria-hidden="true" />
      ) : (
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d={playing ? ICON_PAUSE : ICON_PLAY} />
        </svg>
      )}
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
    <div
      class="segmented"
      role="radiogroup"
      aria-labelledby={labelledBy}
      style={`--n: ${options.length}`}
    >
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

interface SpeakerProps {
  /** true = volume alto (duas ondas); false = baixo (uma onda). */
  loud: boolean
}

/** Ícone decorativo nas pontas do slider. */
function Speaker({ loud }: SpeakerProps) {
  return (
    <svg class="speaker" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICON_SPEAKER} />
      <path d={loud ? ICON_WAVE_HIGH : ICON_WAVE_LOW} />
    </svg>
  )
}

interface RangeProps {
  id: string
  /** ids dos elementos que nomeiam o slider (ex.: título do grupo + "Volume"). */
  labelledBy: string
  /** 0..1 */
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}

/** Slider 0..1 com preenchimento. O nome acessível vem de elementos visíveis. */
function Range({ id, labelledBy, value, onChange, disabled = false }: RangeProps) {
  const percent = Math.round(value * 100)
  return (
    <input
      id={id}
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={value}
      disabled={disabled}
      aria-labelledby={labelledBy}
      aria-valuetext={`${percent}%`}
      style={`--fill: ${percent}%`}
      onInput={(event) => onChange(Number(event.currentTarget.value))}
    />
  )
}

interface SourceCardProps {
  /** Prefixo dos ids (ex.: "ambient"). */
  id: string
  title: string
  children: ComponentChildren
}

/** Cartão de uma fonte de som: título, escolha (filhos) e o volume dela logo abaixo. */
function SourceCard({ id, title, children }: SourceCardProps) {
  return (
    <section class="group" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
  )
}

interface LevelProps {
  id: string
  /** id do título do cartão. */
  titleId: string
  value: number
  onChange: (value: number) => void
  /** Sem som escolhido, o volume não faz nada: fica visível, porém desabilitado. */
  disabled: boolean
}

/** Linha "Volume 30%" de uma fonte de som. */
function Level({ id, titleId, value, onChange, disabled }: LevelProps) {
  const percent = Math.round(value * 100)
  return (
    <div class="level">
      <span id={`${id}-label`}>Volume</span>
      <Range
        id={id}
        labelledBy={`${titleId} ${id}-label`}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      <output htmlFor={id}>{percent}%</output>
    </div>
  )
}

/** Acorde atual em destaque, direto sobre a arte (sem cartão). */
function Stage() {
  const nowChord = useStore((s) => s.nowChord)
  const nowKey = useStore((s) => s.nowKey)
  const nowProg = useStore((s) => s.nowProg)
  const bpm = useStore((s) => s.bpm)
  const playing = useStore((s) => s.playing)

  const detalhes = [nowKey, nowProg, bpm > 0 ? `${bpm} BPM` : ''].filter((item) => item !== '')

  return (
    <section class={playing ? 'stage playing' : 'stage'} aria-labelledby="title-now-playing">
      <h2 id="title-now-playing" class="visually-hidden">
        Tocando agora
      </h2>
      {nowChord ? (
        <>
          <p class="chord" key={nowChord} aria-live="polite">
            {nowChord}
          </p>
          <p class="details">{detalhes.join(' · ')}</p>
        </>
      ) : (
        <p class="idle">Toque em ▶ para começar</p>
      )}
    </section>
  )
}

/** Barra de reprodução fixa na base (alcance do polegar): Tocar/Pausar + volume geral. */
function Dock() {
  const masterVol = useStore((s) => s.masterVol)
  return (
    <div class="dock" role="group" aria-label="Reprodução">
      <PlayButton />
      <div class="dock-volume">
        <Speaker loud={false} />
        <span id="master-label" class="visually-hidden">
          Volume geral
        </span>
        <Range
          id="master-volume"
          labelledBy="master-label"
          value={masterVol}
          onChange={setMasterVolume}
        />
        <Speaker loud />
      </div>
    </div>
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
    <>
      <main class="app">
        <header class="bar">
          <h1>Auto Rainjazz</h1>
          <button
            type="button"
            class="icon-button"
            aria-label="Nova semente: recomeça com outro tom e outra progressão"
            title="Nova semente"
            onClick={() => tratarPromessa(newSeed())}
          >
            <svg class="icon-line" viewBox="0 0 24 24" aria-hidden="true">
              <path d={ICON_DICE} />
              <circle cx="8.5" cy="8.5" r="1" />
              <circle cx="15.5" cy="15.5" r="1" />
              <circle cx="12" cy="12" r="1" />
              <circle cx="15.5" cy="8.5" r="1" />
              <circle cx="8.5" cy="15.5" r="1" />
            </svg>
          </button>
        </header>

        <Stage />

        {error && (
          <p class="alert" role="alert">
            {error}
          </p>
        )}

        <SourceCard id="ambient" title="Ambiente">
          <OptionGroup
            name="ambient"
            labelledBy="ambient-title"
            options={AMBIENT_OPTIONS}
            selected={ambient}
            onSelect={setAmbient}
          />
          <Level
            id="ambient-volume"
            titleId="ambient-title"
            value={ambientVol}
            onChange={setAmbientVolume}
            disabled={ambient === 'none'}
          />
        </SourceCard>

        <SourceCard id="music" title="Música">
          <OptionGroup
            name="music"
            labelledBy="music-title"
            options={MUSIC_OPTIONS}
            selected={music}
            onSelect={(value) => tratarPromessa(setMusic(value))}
          />
          <Level
            id="music-volume"
            titleId="music-title"
            value={musicVol}
            onChange={setMusicVolume}
            disabled={music === 'none'}
          />
        </SourceCard>

        <SourceCard id="sleep" title="Timer de sono">
          <OptionGroup
            name="sleep"
            labelledBy="sleep-title"
            options={SLEEP_OPTIONS}
            selected={sleepMin}
            onSelect={setSleepTimer}
          />
          <p class="footer">O som diminui aos poucos e pausa no tempo escolhido.</p>
        </SourceCard>
      </main>

      <Dock />
    </>
  )
}
