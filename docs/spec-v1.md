# Especificação de implementação v1

Contrato entre módulos. Complementa o `PLANO_CONSTRUCAO.md`. Cada agente edita **somente** os arquivos da sua lista.

## 0. Regras gerais

- TypeScript estrito, ESM, **sem `any`**. Comentários em português; identificadores em inglês.
- Módulos "puros" (`lib/prng`, `theory/*`, `harmony/*`, `voicing`, `melody/*`, `ambient/dsp`) **não importam `tone`** nem tocam DOM, para serem testáveis em Node.
- Determinismo: aleatoriedade dos módulos de música vem **só** de um `Rng` (`src/lib/prng.ts`). **Proibido `Math.random`** neles.
- Antes de qualquer `npm`/`npx`: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH` (o `node` padrão desta máquina está quebrado).
- **Não instalar pacotes.** Verificação: `npx vitest run` e `npx tsc --noEmit`.
- Tempo musical: compasso 4/4 = **8 colcheias ("units")**; `start` ∈ 0..7. Tempos fortes = units **0 e 4**.
- Nada de arquivos fora da sua lista; não alterar a "base pronta".

## 1. Base pronta (NÃO alterar)

| Arquivo | Conteúdo |
|---|---|
| `src/lib/prng.ts` | `Rng` (`next`, `int(min,max)` inclusivo, `pick`, `chance`, `weighted`), `createRng(seed)` |
| `src/audio/music/theory/notes.ts` | `pc`, `midiToName`, `pcName`, `nearestMidi(pitchClass,target,lo,hi)` |
| `src/audio/music/theory/chords.ts` | `Quality`, `Chord`, `CHORD_TONES`, `SHELL`, `MelodyClass`, `melodyClassOf`, `chordPitchClasses`, `chordName` |
| `src/audio/music/harmony/types.ts` | `Mode`, `HarmonyStep`, `HarmonyGen` |
| `src/audio/music/melody/types.ts` | `UNITS_PER_BAR`, `NoteEvent`, `BarContext`, `MelodyGenerator` |
| `src/app/types.ts` | `AmbientKind`, `MusicKind`, `SleepMin` |
| `src/app/store.ts` | `AppState`, `store` (zustand vanilla), `useStore(selector)` |

---

## 2. Agente A — Harmonia + voicing

**Arquivos:** `src/audio/music/harmony/progressions.ts`, `src/audio/music/harmony/harmonyGenerator.ts`, `src/audio/music/voicing.ts`, `tests/harmony.test.ts`, `tests/voicing.test.ts`.

### progressions.ts
```ts
export interface ProgBar { deg: number; quality: Quality }   // deg = semitons acima da tônica
export interface ProgTemplate { name: string; mode: Mode; weight: number; bars: readonly ProgBar[] }
export const PROGRESSIONS: readonly ProgTemplate[]
```
Todas com 4 compassos. Conteúdo exato:

| name | mode | weight | bars (deg, quality) |
|---|---|---|---|
| `ii–V–I` | major | 3 | (2,m7) (7,7) (0,maj7) (0,maj7) |
| `I–vi–ii–V` | major | 3 | (0,maj7) (9,m7) (2,m7) (7,7) |
| `iii–VI–ii–V` | major | 2 | (4,m7) (9,7) (2,m7) (7,7) |
| `I–IV–iii–VI7` | major | 2 | (0,maj7) (5,maj7) (4,m7) (9,7) |
| `ii–V–I–VI7` | major | 3 | (2,m7) (7,7) (0,maj7) (9,7) |
| `iiø–V–i–i` | minor | 2 | (2,m7b5) (7,7) (0,m7) (0,m7) |
| `i–iv–iiø–V` | minor | 2 | (0,m7) (5,m7) (2,m7b5) (7,7) |

### harmonyGenerator.ts
```ts
export class HarmonyGenerator implements HarmonyGen {
  constructor(rng: Rng)
  next(): HarmonyStep
}
```
- Tônica inicial: `rng.int(0, 11)`.
- A cada ciclo (4 compassos) sorteia um template com `rng.weighted` pelos `weight` (pode repetir o anterior).
- Ao **iniciar** cada ciclo a partir do segundo: com probabilidade 0.5 a tônica muda para `(key + rng.pick([5,7,2,10,9,3])) % 12` e `keyChanged = true` no primeiro compasso desse ciclo; senão `false`. O primeiro ciclo tem `keyChanged = false`.
- `chord.root = (key + deg) % 12`; `progLength = 4`; `barInProg` 0..3; `progName`, `mode` vêm do template.

### voicing.ts
```ts
export interface Voicing { bass: number; notes: number[] }    // MIDI; notes em ordem crescente
export function voiceChord(chord: Chord, prev: Voicing | null, extInterval: number): Voicing
```
- `bass`: nota MIDI com pitch class da fundamental, no intervalo [36, 50], mais próxima de 42 (`nearestMidi`).
- `notes`: 3 notas — **3ª, 7ª e `extInterval`** (intervalos a partir da fundamental, de `SHELL[quality]`), como pitch classes `pc(root + interval)`.
- Gerar candidatos: para cada rotação da ordem das 3 pitch classes (qual fica embaixo) e cada `lo` de 50 a 62, empilhar as notas em ordem crescente (cada nota é a menor MIDI **maior** que a anterior com aquela pitch class; a primeira é a menor MIDI ≥ `lo` com a pc).
- Rejeitar candidato se: nota mais aguda > 76; ou algum intervalo entre notas adjacentes < 2 semitons.
- Custo: com `prev`, soma de `|notes[i] - prev.notes[i]|`; sem `prev`, `|média(notes) - 62|`. Escolher o de menor custo (empate: o primeiro encontrado). Esse é o **voice leading**: minimizar o movimento total.
- Garantia: sempre existe candidato válido para as 4 qualidades do `SHELL` (testar).

### Testes (Vitest, `tests/`)
- harmonia: determinismo por seed; ciclos de 4 compassos; `barInProg` sequencial; qualidades válidas; primeira `keyChanged === false`; ao longo de 400 compassos aparecem ≥ 3 templates distintos e ≥ 2 mudanças de tonalidade; `chord.root` coerente com o template (recalcular `(key+deg)%12`).
- voicing: para 500 acordes aleatórios (todas as qualidades, `ext` sorteado de `SHELL`), encadeados com `prev`: notas ascendentes; contêm a 3ª e a 7ª; topo ≤ 76 e base ≥ 50; adjacentes ≥ 2; `bass` com pc da fundamental em [36,50]; **movimento médio por voz entre acordes consecutivos ≤ 4 semitons**.

---

## 3. Agente B — Melodia Markov

**Arquivos:** `src/audio/music/melody/corpus.ts`, `src/audio/music/melody/markovMelody.ts`, `tests/markov.test.ts`.

### corpus.ts
Frases de **1 compasso (soma das durações = 8)** relativas à fundamental do acorde. Token `pc:dur` (pc = semitons acima da fundamental, 0..11; `r` = pausa; dur em units). Exportar:
```ts
export const CORPUS: Record<MelodyClass, readonly string[]>
```
Conteúdo exato (cada string = uma frase):

**maj:** `"4:2 7:2 11:3 r:1"`, `"r:2 7:1 9:1 11:2 r:2"`, `"0:3 r:1 4:2 2:2"`, `"11:2 9:1 7:1 4:4"`, `"7:4 r:2 4:2"`, `"r:1 4:1 7:2 9:2 7:2"`, `"2:2 4:2 7:4"`, `"11:4 r:1 9:1 7:2"`, `"4:3 r:1 2:1 0:3"`, `"r:4 7:2 11:2"`

**min:** `"3:2 7:2 10:3 r:1"`, `"r:2 5:1 7:1 10:2 r:2"`, `"0:3 r:1 3:2 2:2"`, `"10:2 7:1 5:1 3:4"`, `"7:4 r:2 3:2"`, `"r:1 3:1 5:2 7:2 10:2"`, `"2:2 3:2 7:4"`, `"10:4 r:1 9:1 7:2"`, `"3:3 r:1 2:1 0:3"`, `"r:4 7:2 10:2"`

**dom:** `"4:2 7:2 10:3 r:1"`, `"r:2 9:1 10:1 7:2 r:2"`, `"10:3 r:1 9:2 7:2"`, `"7:2 5:1 4:1 2:4"`, `"4:4 r:2 7:2"`, `"r:1 7:1 9:2 10:2 7:2"`, `"0:2 2:2 4:4"`, `"10:4 r:1 9:1 7:2"`, `"7:3 r:1 4:1 2:3"`, `"r:4 4:2 10:2"`

### markovMelody.ts
```ts
export interface MarkovOptions { restBarProb?: number; order1Mix?: number; temperature?: number }
export class MarkovMelody implements MelodyGenerator {
  constructor(rng: Rng, opts?: MarkovOptions)   // defaults: restBarProb 0.22, order1Mix 0.35, temperature 1.0
  nextBar(ctx: BarContext): NoteEvent[]
  reset(seed: number): void                      // novo createRng(seed), last = 74
}
```
**Treino (ao construir; microssegundos):** para cada `MelodyClass`, para cada frase: sequência `['^', ...tokens, '$']` (`^` = início, `$` = fim). Contar transições de **ordem 2** (chave `"a|b"` → próximo) e **ordem 1** (chave `"b"` → próximo). Token é a string `pc:dur` ou `r:dur` literal.

**Geração de um compasso:**
1. Com prob. `restBarProb` → retorna `[]` (compasso só de harmonia).
2. `class = melodyClassOf(chord.quality)`. Contexto inicial `prev2 = '^'`, `prev1 = '^'`, `pos = 0`.
3. Enquanto `pos < 8`: com prob. `1 - order1Mix` e se a chave de ordem 2 `"prev2|prev1"` existir, usar ordem 2; senão ordem 1 (`prev1`). Se não houver candidatos → parar. Sortear o próximo token com peso `count ** (1/temperature)`. Se for `$` → parar (o resto do compasso fica em silêncio). Senão processar o token e avançar `pos += dur` (truncar a duração para `8 - pos` se passar).
4. **Mapeamento p/ m7b5:** se `chord.quality === 'm7b5'`, pc 7 → 6 e pc 9 → 8 (antes de tudo).
5. **Tempo forte (pos 0 ou 4):** se o pc (absoluto = `(root + pc) % 12`) **não** for nota do acorde (`chordPitchClasses`), trocar pela nota do acorde de menor distância em pitch class (circular).
6. **Altura:** `nearestMidi(pcAbsoluto, this.last, 66, 84)`; atualizar `this.last`.
7. **Velocity:** `0.42 + rng.next() * 0.18`, `+0.06` se `pos` for 0 ou 4 (limitar a 1).
8. Pausas apenas avançam `pos` (não geram evento). Eventos saem ordenados, `start + dur <= 8`.

### Testes (`tests/markov.test.ts`)
- corpus: toda frase soma 8 e todo token é válido (`pc` 0..11 ou `r`, dur ≥ 1).
- determinismo: mesma seed ⇒ mesma saída em 100 compassos.
- invariantes em 300 compassos por qualidade (`maj7`, `m7`, `7`, `m7b5`) e raízes variadas: `start` ∈ [0,7], `dur ≥ 1`, `start+dur ≤ 8`, sem sobreposição, `midi` ∈ [66,84], velocity ∈ (0,1]; **notas em `start` 0 ou 4 têm pitch class de nota do acorde**; salto entre notas consecutivas ≤ 11 semitons.
- variedade: em 200 compassos sobre `m7`, ≥ 25 padrões distintos (assinatura `start:dur:midi`); fração de compassos vazios entre 10% e 40% com `restBarProb` padrão.

---

## 4. Agente C — Ambiente (ruído)

**Arquivos:** `src/audio/ambient/dsp.ts`, `src/audio/ambient/ambientEngine.ts`, `tests/dsp.test.ts`.

### dsp.ts (puro, sem Tone)
```ts
export function poisson(lambda: number, rand: () => number): number            // Knuth; lambda <= 10
export function makeDropData(sampleRate: number, rand: () => number): Float32Array
```
`makeDropData`: gota de ~90 ms: `f = 1800 + rand()*3500`, `tau = 0.012 + rand()*0.012`; amostra `i` (t = i/sampleRate): `(sin(2π f t)*0.6 + (rand()*2-1)*0.4) * exp(-t/tau)`; no fim, aplicar fade-out linear nos últimos 5 ms. Testes: comprimento ≈ 0.09*sr; valores finitos e |x| ≤ 1; energia decai (RMS da 1ª metade > RMS da 2ª); `poisson` com `lambda=0` ⇒ 0 e média ≈ lambda em 5000 amostras (tolerância 5%).

### ambientEngine.ts (usa Tone + Web Audio)
```ts
import * as Tone from 'tone'
import type { AmbientKind } from '../../app/types'
export class AmbientEngine {
  constructor(out: Tone.ToneAudioNode)     // conecta sua saída em `out`
  set(kind: AmbientKind): void             // troca de preset com rampas (crossfade ~2 s)
  dispose(): void
}
```
Grafo: `Tone.Noise('brown') → Tone.Filter(lowpass) → gB(Gain)` e `Tone.Noise('pink') → Tone.Filter(bandpass, Q 0.5) → gP(Gain)`; `gB`, `gP` e `dropBus(Gain)` → `out`. `Tone.LFO` (0.09 Hz, `min`/`max` = faixa do lowpass) conectado a `lpB.frequency` e iniciado uma vez.

Presets:
| kind | brownGain | lpHz [min,max] | pinkGain | bpHz | dropsPerSec | dropGain |
|---|---|---|---|---|---|---|
| none | 0 | [300,600] | 0 | 3000 | 0 | 0 |
| wind | 0.55 | [220,900] | 0.05 | 1200 | 0 | 0 |
| lightRain | 0.12 | [300,500] | 0.22 | 3200 | 9 | 0.10 |
| rain | 0.30 | [350,600] | 0.42 | 2600 | 30 | 0.07 |

`set(kind)`: se `kind !== 'none'` e os ruídos estão parados, dar `start()` neles; `rampTo` (2 s) em `gB.gain`, `gP.gain`, `bpP.frequency`, (1 s) em `dropBus.gain`; atualizar `lfo.min/max`; guardar `density`. Se `kind === 'none'`: após 2.2 s, **se ainda for `none`**, parar ruídos e o timer de gotas (CPU ≈ 0).

Gotas: criar ~6 `AudioBuffer`s (mono) uma vez com `makeDropData(rawCtx.sampleRate, Math.random)` (aqui `Math.random` é permitido). Um `setInterval` de 80 ms (só ativo quando `density > 0`): `n = poisson(density*0.08, Math.random)`; para cada gota: `AudioBufferSourceNode` com buffer sorteado, `playbackRate` ∈ [0.8,1.3], `GainNode` com ganho ∈ [0.4,1], `StereoPannerNode` com pan ∈ [-0.8,0.8]; `source.start(ctx.currentTime + 0.02 + Math.random()*0.08)`; ligar em `dropBus` com `Tone.connect(node, dropBus)`. `rawCtx = Tone.getContext().rawContext as AudioContext`.

`dispose()` para timers e nós.

---

## 5. Agente D — Interface

**Arquivos:** `index.html`, `src/main.tsx`, `src/app/App.tsx`, `src/styles.css`.

- A UI **só lê** o estado via `useStore` (`src/app/store.ts`) e **só altera** via funções do controlador `src/audio/audioController.ts` (escrito por outro agente; contrato abaixo). **Não** chamar `store.setState`.
- Pode haver erro de TypeScript por falta de `audioController` enquanto ele não existir; qualquer **outro** erro é seu.

Contrato do controlador (`src/audio/audioController.ts`):
```ts
export function play(): Promise<void>
export function pause(): void
export function setAmbient(kind: AmbientKind): void
export function setMusic(kind: MusicKind): Promise<void>
export function setAmbientVolume(v: number): void   // 0..1
export function setMusicVolume(v: number): void     // 0..1
export function newSeed(): Promise<void>            // recomeça com outro tom/progressão
export function setSleepTimer(min: SleepMin): void
```

Interface (tudo em **português**), mobile-first, tema escuro, `prefers-reduced-motion` respeitado:
1. Título "Auto Rainjazz" + subtítulo curto.
2. Botão grande **Play/Pausa** (`aria-label`, estado `loading` desabilita e mostra "Carregando…").
3. **Ambiente**: grupo segmentado (`role="radiogroup"`): Nenhum / Brisa / Chuva leve / Chuva ↔ `none/wind/lightRain/rain`.
4. **Música**: Nenhuma / Piano ↔ `none/piano`.
5. Dois sliders `<input type="range" min=0 max=1 step=0.01>` rotulados (volume do ambiente, da música).
6. **Timer de sono**: Desligado / 15 min / 30 min / 60 min ↔ `0/15/30/60`.
7. Botão **Nova semente**.
8. Painel "Tocando agora": `nowChord` em destaque, e `nowKey · nowProg · {bpm} BPM` (esconder se vazio/0).
9. Mensagem de erro (`error`) em `role="alert"`.
- `index.html`: `lang="pt-BR"`, viewport, `theme-color`, `<title>Auto Rainjazz</title>`, `<div id="app">`, `<script type="module" src="/src/main.tsx">`.
- `main.tsx`: `render(<App />, document.getElementById('app')!)` (de `preact`) e `import './styles.css'`.
- Visual: fundo escuro azul-arroxado (#14101f → #1d1830), acento âmbar (#ffb45e), cartões com cantos arredondados, foco visível, alvos de toque ≥ 44 px, sem dependências de CSS externas.

---

## 6. Agente E — Integração de áudio (fase 2, depois de A, B e C)

**Arquivos:** `src/audio/music/instruments/piano.ts`, `src/audio/music/musicEngine.ts`, `src/audio/audioController.ts`.

### piano.ts
`Tone.Sampler` com Salamander hospedado em `https://tonejs.github.io/audio/salamander/`, `baseUrl` e `urls` com um sample a cada 3 semitons de **C2 a C7**: nota `C2, D#2, F#2, A2, C3, ...` (arquivo `C2.mp3`, **`Ds2.mp3`**, **`Fs2.mp3`**, `A2.mp3`, …; as sustenidas usam `s` no nome). `release: 1.2`. Cadeia: `sampler → Tone.Filter(5200,'lowpass') → Tone.JCReverb({roomSize: 0.5, wet: 0.3}) → out`. Exporta `class Piano { constructor(out); load(): Promise<void>; play(midi, durSec, time, velocity): void; releaseAll(): void; dispose() }` (usa `midiToName`).

### musicEngine.ts
```ts
export interface BarInfo { chord: string; key: string; prog: string; bpm: number }
export class MusicEngine {
  constructor(out: Tone.ToneAudioNode)
  load(): Promise<void>
  start(seed: number, onBar: (i: BarInfo) => void): void
  stop(): void
}
```
`start`: `rng = createRng(seed)`; `HarmonyGenerator(rng)`; `MarkovMelody(createRng(seed ^ 0x9e3779b9))`; `bpm = 56 + rng.int(0, 16)`; `Tone.Transport.bpm.value = bpm`; `Tone.Transport.scheduleRepeat((time) => this.playBar(time), '1m')`; `Tone.Transport.start('+0.1')`. `stop`: `Transport.stop()`, `cancel()`, `piano.releaseAll()`.

`playBar(time)` (`beat = 60/bpm`, `unit = beat/2`):
- `step = harmony.next()`; `ext = rng.pick(SHELL[quality].ext)`; `v = voiceChord(chord, prevVoicing, ext)`.
- **Baixo** em `time`, dur `3.4*beat`, velocity 0.45. **Acorde** (3 notas) em `time + 0.02 + i*0.022 + jitter`, dur `2.6*beat`, velocity 0.30–0.42.
- Com prob. 0.45: **recomp** das 3 notas em `time + 5*unit` (swing), dur `1.2*beat`, velocity 0.22–0.3.
- **Melodia:** `melody.nextBar({chord, barIndex})`; cada nota em `time + start*unit + swing + jitter`, dur `dur*unit*0.95`, velocity do evento. `swing = (start % 2 === 1) ? 0.14*unit : 0`; `jitter = (rng.next()-0.5)*0.024`.
- `Tone.Draw.schedule(() => onBar({...}), time)`.
- Usar um `Rng` próprio do engine para jitter/ext/recomp (derivado da seed), nunca `Math.random`.
- `key` exibido: `` `${pcName(step.key)} ${step.mode === 'major' ? 'maior' : 'menor'}` ``.

### audioController.ts
Implementa o contrato da seção 5 e atualiza `store` (`playing`, `loading`, `error`, `ambient`, `music`, `ambientVol`, `musicVol`, `seed`, `sleepMin`, `nowChord`, `nowKey`, `nowProg`, `bpm`).
- Inicialização **lazy** no primeiro `play()` (`await Tone.start()`): `limiter = new Tone.Limiter(-1).toDestination()`; `master = new Tone.Gain(1).connect(limiter)`; `ambientBus`, `musicBus` (`Tone.Gain`) → `master`; `AmbientEngine(ambientBus)`; `MusicEngine(musicBus)`. Volume do slider `v` → `gain.rampTo(v*v, 0.05)`.
- `play()`: `loading=true`; cancelar timer de parada pendente; `master.gain.rampTo(1,0.4)`; `ambient.set(state.ambient)`; se `music==='piano'`: `await engine.load()`, `engine.start(state.seed, onBar)`; `playing=true`, `loading=false`; armar o timer de sono. Erros ⇒ `error` + `loading=false`.
- `pause()`: `playing=false`; `master.gain.rampTo(0,0.5)`; após 600 ms (guardar o id; `play()` cancela): `music.stop()` e `ambient.set('none')`.
- `setAmbient`/`setMusic`: atualizam o store e, se estiver tocando, aplicam (`setMusic('piano')` carrega+inicia; `'none'` para).
- `newSeed()`: `seed` aleatório (`Math.random` é permitido aqui); se estiver tocando com piano, `stop()` e `start(novaSeed)`.
- `setSleepTimer(min)`: guarda `sleepMin`; limpa o timer anterior; se `min>0` e estiver tocando, agenda em `min*60 - 15` s um fade-out de 15 s do `master` seguido de `pause()`. Ao dar `play()` com `sleepMin>0`, rearmar.
