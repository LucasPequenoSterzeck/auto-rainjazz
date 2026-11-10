import * as Tone from 'tone'
import { store, type AppState } from '../app/store'
import type { AmbientKind, MusicKind, SleepMin } from '../app/types'
import artworkUrl from '../assets/bg.jpg'
import { AmbientEngine } from './ambient/ambientEngine'
import { MusicEngine, type BarInfo, type Lineup } from './music/musicEngine'

/** Entrada do fade-in ao dar play (s). */
const FADE_IN_S = 0.4
/** Saída do fade-out ao pausar (s). */
const FADE_OUT_S = 0.5
/** Tempo até parar os motores depois de pausar (ms); play() cancela. */
const PAUSE_STOP_MS = 600
/** Rampa de volume dos sliders (s). */
const VOLUME_RAMP_S = 0.05
/** Fade-out do timer de sono (s). Termina no minuto marcado. */
const SLEEP_FADE_S = 15
const MSG_ERRO_AUDIO = 'Não foi possível iniciar o áudio. Tente de novo.'
const MSG_ERRO_SONS = 'Não foi possível carregar os sons dos instrumentos. Pause e toque de novo.'
const MSG_ERRO_CHUVA = 'Não foi possível carregar o som da chuva. Escolha o ambiente de novo.'

/** Grafo de áudio, criado de forma lazy no primeiro play(). */
interface Graph {
  master: Tone.Gain
  ambientBus: Tone.Gain
  musicBus: Tone.Gain
  ambient: AmbientEngine
  music: MusicEngine
}

let graph: Graph | null = null
let initing: Promise<Graph> | null = null
/** Incrementado a cada play/pause: continuações assíncronas antigas se descartam. */
let runToken = 0
/** true quando o MusicEngine foi iniciado e ainda não foi parado. */
let musicActive = false
/** Formação que o MusicEngine está tocando (null se parado). */
let activeLineup: Lineup | null = null
/** Quantas operações de carregamento estão pendentes (para `loading`). */
let busyCount = 0

let pauseStopTimer: ReturnType<typeof setTimeout> | null = null
let sleepFadeTimer: ReturnType<typeof setTimeout> | null = null
let sleepPauseTimer: ReturnType<typeof setTimeout> | null = null

const current = (): AppState => store.getState()
const patch = (values: Partial<AppState>): void => {
  store.setState(values)
}
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
/** Volume do slider -> ganho (curva quadrática, mais perceptual). */
const volumeToGain = (v: number): number => clamp01(v) * clamp01(v)
/** Formação de instrumentos da escolha de música; null para 'none'. */
const lineupOf = (kind: MusicKind): Lineup | null => (kind === 'none' ? null : kind)

function beginBusy(): void {
  busyCount++
  patch({ loading: true })
}

function endBusy(): void {
  busyCount = Math.max(0, busyCount - 1)
  patch({ loading: busyCount > 0 })
}

function reportError(erro: unknown, mensagem: string = MSG_ERRO_AUDIO): void {
  console.error('Falha no áudio:', erro)
  patch({ error: mensagem })
}

/**
 * Se o sistema suspender ou interromper o áudio (iOS, chamada, fone desconectado),
 * a tela passa a mostrar "Tocar" em vez de continuar dizendo que está tocando.
 * O próximo play() retoma o contexto.
 */
function onContextStateChange(): void {
  if (Tone.getContext().state !== 'running' && current().playing) pause()
}

/** Controles do sistema (tela de bloqueio, teclas de mídia), onde o navegador oferece. */
function setupMediaSession(): void {
  if (!('mediaSession' in navigator)) return
  const session = navigator.mediaSession
  session.metadata = new MediaMetadata({
    title: 'Auto Rainjazz',
    artist: 'Jazz gerado em tempo real',
    album: 'Com chuva ao fundo',
    artwork: [{ src: artworkUrl, type: 'image/jpeg' }],
  })
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => void play().catch((erro: unknown) => console.error('Falha no play:', erro))],
    ['pause', () => pause()],
    ['stop', () => pause()],
  ]
  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler)
    } catch {
      // Ação não suportada neste navegador: ignora.
    }
  }
  store.subscribe((s) => {
    session.playbackState = s.playing ? 'playing' : 'paused'
  })
}

/** Cria o grafo de áudio uma única vez. Precisa estar em um gesto do usuário (play). */
async function buildGraph(): Promise<Graph> {
  await Tone.start()
  const limiter = new Tone.Limiter(-1).toDestination()
  // Começa em 0: o fade-in de play() sobe até 1.
  const master = new Tone.Gain(0).connect(limiter)
  const { ambientVol, musicVol } = current()
  const ambientBus = new Tone.Gain(volumeToGain(ambientVol)).connect(master)
  const musicBus = new Tone.Gain(volumeToGain(musicVol)).connect(master)
  Tone.getContext().on('statechange', onContextStateChange)
  setupMediaSession()
  return {
    master,
    ambientBus,
    musicBus,
    ambient: new AmbientEngine(ambientBus, (erro: unknown) => reportError(erro, MSG_ERRO_CHUVA)),
    music: new MusicEngine(musicBus),
  }
}

function ensureGraph(): Promise<Graph> {
  if (graph !== null) return Promise.resolve(graph)
  if (initing === null) {
    initing = buildGraph().then(
      (g) => {
        graph = g
        return g
      },
      (erro: unknown) => {
        initing = null
        throw erro
      },
    )
  }
  return initing
}

function onBar(info: BarInfo): void {
  patch({ nowChord: info.chord, nowKey: info.key, nowProg: info.prog, bpm: info.bpm })
}

/** Para a música e limpa a exibição. Idempotente. */
function stopMusic(): void {
  if (musicActive && graph !== null) graph.music.stop()
  musicActive = false
  activeLineup = null
  patch({ nowChord: '', nowKey: '', nowProg: '', bpm: 0 })
}

/** Para tudo depois do fade-out: música e ambiente (CPU ~0). */
function stopAudio(): void {
  stopMusic()
  graph?.ambient.set('none')
}

function clearPauseStop(): void {
  if (pauseStopTimer !== null) {
    clearTimeout(pauseStopTimer)
    pauseStopTimer = null
  }
}

function clearSleepTimers(): void {
  if (sleepFadeTimer !== null) {
    clearTimeout(sleepFadeTimer)
    sleepFadeTimer = null
  }
  if (sleepPauseTimer !== null) {
    clearTimeout(sleepPauseTimer)
    sleepPauseTimer = null
  }
}

/** Arma o timer de sono: fade-out de 15 s terminando no minuto escolhido, depois pause(). */
function armSleepTimer(): void {
  // Rearmado no meio do fade-out final: devolve o volume, senão ficaria "tocando" em silêncio.
  const wasFading = sleepPauseTimer !== null
  clearSleepTimers()
  const { sleepMin, playing } = current()
  if (wasFading && playing) graph?.master.gain.rampTo(1, FADE_IN_S)
  if (sleepMin <= 0 || !playing) return
  const fadeAtMs = sleepMin * 60_000 - SLEEP_FADE_S * 1000
  sleepFadeTimer = setTimeout(() => {
    sleepFadeTimer = null
    const g = graph
    if (g === null || !current().playing) return
    g.master.gain.rampTo(0, SLEEP_FADE_S)
    sleepPauseTimer = setTimeout(() => {
      sleepPauseTimer = null
      pause()
    }, SLEEP_FADE_S * 1000)
  }, fadeAtMs)
}

/**
 * Faz a música tocando corresponder à escolha atual: inicia, troca a formação
 * (piano ↔ piano + violino) ou não faz nada. Carrega os samples que faltarem.
 * Depois de cada espera, confere de novo o estado: se o usuário pausou ou mudou
 * a escolha no meio do carregamento, desiste (quem mudou cuida do novo estado).
 */
async function syncMusic(): Promise<void> {
  const lineup = lineupOf(current().music)
  if (lineup === null || !current().playing) return
  if (musicActive && activeLineup === lineup) return
  const token = runToken
  beginBusy()
  try {
    const g = await ensureGraph()
    await g.music.load(lineup)
    const s = current()
    if (token !== runToken || !s.playing || s.music !== lineup) return
    if (!musicActive) {
      g.music.start(s.seed, lineup, onBar)
      musicActive = true
    } else if (activeLineup !== lineup) {
      g.music.setLineup(lineup)
    }
    activeLineup = lineup
  } catch (erro: unknown) {
    if (token !== runToken) return
    reportError(erro, MSG_ERRO_SONS)
    // Se a música já tocava, a escolha volta para o que de fato está soando.
    if (activeLineup !== null && current().music === lineup) patch({ music: activeLineup })
  } finally {
    endBusy()
  }
}

/** Toca. Inicializa o áudio na primeira vez. Erros viram `error` do store. */
export async function play(): Promise<void> {
  if (current().playing) return
  const token = ++runToken
  // Cancela a parada pendente de uma pausa recente: o áudio continua.
  clearPauseStop()
  beginBusy()
  patch({ error: undefined })
  // Retoma o contexto ainda dentro do gesto do usuário (o sistema pode tê-lo suspendido).
  const resumed = Tone.start()
  try {
    await resumed
    const g = await ensureGraph()
    if (token !== runToken) return
    g.master.gain.rampTo(1, FADE_IN_S)
    g.ambient.set(current().ambient)
    // `playing` já é true durante o carregamento dos samples: trocas de ambiente
    // e de música feitas nesse intervalo valem na hora.
    patch({ playing: true })
    armSleepTimer()
    await syncMusic()
  } catch (erro: unknown) {
    if (token !== runToken) return
    reportError(erro)
    pause()
  } finally {
    endBusy()
  }
}

/** Pausa com fade-out; para os motores depois de 600 ms, salvo se play() voltar antes. */
export function pause(): void {
  runToken++
  clearSleepTimers()
  clearPauseStop()
  patch({ playing: false, loading: false })
  const g = graph
  if (g === null) return
  g.master.gain.rampTo(0, FADE_OUT_S)
  pauseStopTimer = setTimeout(() => {
    pauseStopTimer = null
    stopAudio()
  }, PAUSE_STOP_MS)
}

export function setAmbient(kind: AmbientKind): void {
  patch({ ambient: kind })
  if (current().playing && graph !== null) graph.ambient.set(kind)
}

export async function setMusic(kind: MusicKind): Promise<void> {
  patch({ music: kind })
  if (kind === 'none') {
    stopMusic()
    return
  }
  await syncMusic()
}

export function setAmbientVolume(v: number): void {
  const level = clamp01(v)
  patch({ ambientVol: level })
  graph?.ambientBus.gain.rampTo(volumeToGain(level), VOLUME_RAMP_S)
}

export function setMusicVolume(v: number): void {
  const level = clamp01(v)
  patch({ musicVol: level })
  graph?.musicBus.gain.rampTo(volumeToGain(level), VOLUME_RAMP_S)
}

/** Nova seed: outro tom e progressão. Se a música estiver tocando, reinicia com ela. */
export async function newSeed(): Promise<void> {
  patch({ seed: Math.floor(Math.random() * 2 ** 32) })
  if (current().playing && current().music !== 'none') {
    stopMusic()
    await syncMusic()
  }
}

export function setSleepTimer(min: SleepMin): void {
  patch({ sleepMin: min })
  armSleepTimer()
}
