import type { ComponentChildren } from 'preact'
import avatarUrl from '../assets/kit/avatar.png'
import sleepUrl from '../assets/kit/pose-dormindo.png'
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
/** Alto-falante (corpo) + ondas; mesmo traço de 2 px nos dois ícones, para casar com o texto. */
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
      <svg key={playing ? 'pause' : 'play'} class="icon" viewBox="0 0 24 24" aria-hidden="true">
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

/** Ícone decorativo nas pontas do slider (o rótulo do slider já diz o que ele controla). */
function Speaker({ loud }: SpeakerProps) {
  return (
    <svg class="speaker" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICON_SPEAKER} />
      <path d={loud ? ICON_WAVE_HIGH : ICON_WAVE_LOW} />
    </svg>
  )
}

interface VolumeSliderProps {
  id: string
  label: string
  /** 0..1 */
  value: number
  onChange: (value: number) => void
  /** Mostra os ícones de volume baixo/alto nas pontas (HIG › Sliders). */
  icons?: boolean
}

/** Slider 0..1 com rótulo visível e valor em porcentagem. */
function VolumeSlider({ id, label, value, onChange, icons = false }: VolumeSliderProps) {
  const percent = Math.round(value * 100)
  return (
    <div class="slider-row">
      <div class="label-row">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{percent}%</output>
      </div>
      <div class="slider-line">
        {icons && <Speaker loud={false} />}
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
        {icons && <Speaker loud />}
      </div>
    </div>
  )
}

interface SectionProps {
  /** id do título; rotula o grupo para leitores de tela. */
  id: string
  title: string
  /** Texto de apoio abaixo do grupo. */
  footer?: string
  /** Ilustração decorativa ao lado da nota (sem texto alternativo). */
  art?: string
  children: ComponentChildren
}

/** Grupo no estilo "inset grouped": título pequeno fora do cartão, controles dentro. */
function Section({ id, title, footer, art, children }: SectionProps) {
  return (
    <section class="section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div class="group">{children}</div>
      {(footer || art) && (
        <div class="footer-row">
          {footer && <p class="footer">{footer}</p>}
          {art && <img class="art" src={art} alt="" width="96" loading="lazy" />}
        </div>
      )}
    </section>
  )
}

/** Cartão de destaque: acorde atual, detalhes e o botão Tocar/Pausar. */
function Hero() {
  const nowChord = useStore((s) => s.nowChord)
  const nowKey = useStore((s) => s.nowKey)
  const nowProg = useStore((s) => s.nowProg)
  const bpm = useStore((s) => s.bpm)

  const detalhes = [nowKey, nowProg, bpm > 0 ? `${bpm} BPM` : ''].filter((item) => item !== '')

  return (
    <section class="hero" aria-labelledby="title-now-playing">
      <h2 id="title-now-playing">Tocando agora</h2>
      <p class="chord" key={nowChord}>
        {nowChord || '—'}
      </p>
      <p class="details">{detalhes.length > 0 ? detalhes.join(' · ') : 'Toque para começar'}</p>
      <PlayButton />
    </section>
  )
}

/** Tela principal. Lê o estado com useStore e age somente pelo controlador de áudio. */
export function App() {
  const ambient = useStore((s) => s.ambient)
  const music = useStore((s) => s.music)
  const sleepMin = useStore((s) => s.sleepMin)
  const masterVol = useStore((s) => s.masterVol)
  const ambientVol = useStore((s) => s.ambientVol)
  const musicVol = useStore((s) => s.musicVol)
  const error = useStore((s) => s.error)

  return (
    <main class="app">
      <header class="header">
        <img class="avatar" src={avatarUrl} alt="" width="56" height="56" />
        <div>
          <h1>Auto Rainjazz</h1>
          <p class="subtitle">Jazz suave gerado em tempo real, com chuva ao fundo.</p>
        </div>
      </header>

      <Hero />

      {error && (
        <p class="alert" role="alert">
          {error}
        </p>
      )}

      <Section id="title-volumes" title="Volume">
        <VolumeSlider
          id="master-volume"
          label="Volume geral"
          value={masterVol}
          onChange={setMasterVolume}
          icons
        />
        <hr class="divider" />
        <VolumeSlider
          id="ambient-volume"
          label="Ambiente"
          value={ambientVol}
          onChange={setAmbientVolume}
        />
        <VolumeSlider
          id="music-volume"
          label="Música"
          value={musicVol}
          onChange={setMusicVolume}
        />
      </Section>

      <Section id="title-ambient" title="Ambiente">
        <OptionGroup
          name="ambient"
          labelledBy="title-ambient"
          options={AMBIENT_OPTIONS}
          selected={ambient}
          onSelect={setAmbient}
        />
      </Section>

      <Section id="title-music" title="Música">
        <OptionGroup
          name="music"
          labelledBy="title-music"
          options={MUSIC_OPTIONS}
          selected={music}
          onSelect={(value) => tratarPromessa(setMusic(value))}
        />
      </Section>

      <Section
        id="title-sleep"
        title="Timer de sono"
        footer="O som diminui aos poucos e pausa no tempo escolhido."
        art={sleepUrl}
      >
        <OptionGroup
          name="sleep"
          labelledBy="title-sleep"
          options={SLEEP_OPTIONS}
          selected={sleepMin}
          onSelect={setSleepTimer}
        />
      </Section>

      <Section
        id="title-generate"
        title="Composição"
        footer="Recomeça com outro tom e outra progressão."
      >
        <button type="button" class="row-button" onClick={() => tratarPromessa(newSeed())}>
          Nova semente
        </button>
      </Section>
    </main>
  )
}
