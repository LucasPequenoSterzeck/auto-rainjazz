# Contexto — Auto Rainjazz

> Documento de continuidade: o que o projeto é, como está construído, o que foi decidido, o que já foi verificado e o que falta. Atualizado em 09/11/2026.
> Detalhes complementares: `PLANO_CONSTRUCAO.md` (plano e roadmap), `docs/spec-v1.md` (contratos entre módulos), `README.md` (apresentação).

## 1. O que é

PWA leve que **gera jazz suave (piano) em tempo real, no próprio dispositivo**, sobre um **ruído ambiente** selecionável (Nenhum / Brisa / Chuva leve / Chuva). Inspiração: canais de YouTube "Jazz relaxante + barulho de chuva para concentração".

- **v1 (construída):** harmonia por regras + voice leading + melodia Markov de ordem 2 + piano Salamander (samples).
- **v2 (opcional, não iniciada):** melodia por rede neural (Magenta/TF.js) com comparação A/B contra o Markov. Só entra se o Markov soar limitado.
- **Restrição principal:** leve. Sem TF.js no bundle base; CPU baixa (meta: < ~8% de um núcleo).

## 2. Stack e ambiente

| Item | Escolha |
|---|---|
| Build | Vite 8, TypeScript 7 (strict, **sem `any`**) |
| UI | Preact 11 (+ `@preact/preset-vite`) |
| Estado | Zustand vanilla (`src/app/store.ts`) com hook próprio `useStore` (sem `preact/compat`) |
| Áudio | Tone.js 15 |
| Testes | Vitest 5 (`tests/**/*.test.ts`, ambiente node) |

**Atenção ao Node:** o `node` padrão da máquina (v26) está quebrado (falta `libsimdjson.33` do Homebrew). Usar sempre:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm run dev        # servidor de desenvolvimento
npm run build      # tsc --noEmit && vite build
npm test           # vitest run
npm run typecheck
```

Sugestão já dada ao usuário: `brew reinstall node` para consertar o Node padrão.

## 3. Arquitetura

```
src/
  main.tsx, app/
    App.tsx        UI: botão play, seletores de ambiente/música, sliders, timer de sono, nova semente
    store.ts       AppState + store + useStore
    types.ts       AmbientKind, MusicKind, SleepMin
  audio/
    audioController.ts   API pública do áudio (ver §5)
    ambient/
      ambientEngine.ts   presets de ambiente (brisa/chuva leve/chuva)
      dsp.ts             poisson, makeDropData, makeRainBed (chuva procedural)
    music/
      musicEngine.ts     agenda 1 compasso por vez no Transport
      voicing.ts         voice leading (movimento total mínimo)
      harmony/           progressions.ts, harmonyGenerator.ts, types.ts
      melody/            corpus.ts, markovMelody.ts, types.ts
      instruments/piano.ts   Sampler Salamander -> Filter -> JCReverb
      theory/            notes.ts, chords.ts
  lib/prng.ts            mulberry32 (aleatoriedade determinística por seed)
  assets/bg.jpg          fundo do app (313 KB)
  styles.css
tests/   dsp, harmony, markov, voicing  (34 testes)
docs/    spec-v1.md, assets/ (banner)
```

### Grafo de áudio

```
Piano: Sampler -> Filter(lowpass 5200 Hz) -> JCReverb(roomSize 0.5, wet 0.3) -> musicBus
Ambiente: ruídos/loops -> ambientBus
musicBus + ambientBus -> master Gain (começa em 0; fade-in/out) -> Limiter(-1 dB) -> destino
```

Volume do slider → ganho por curva **quadrática** (`v²`): 30% no slider ≈ 9% de ganho real.

## 4. Música (regras)

- Compasso = 8 "unidades" (colcheias); tempos fortes = unidades 0 e 4. Transport com `scheduleRepeat('1m')`, BPM 56–72 (sorteado pela seed).
- **Harmonia:** templates de 4 compassos (ii–V–I etc.); troca de tonalidade com p = 0,5.
- **Voicings:** shell (3ª + 7ª + extensão) + baixo na batida 1; **voice leading** = escolher a inversão que minimiza o movimento total em relação ao acorde anterior (evita saltos, soa mais "piano de verdade").
- **Melodia Markov:** ordem 2 com mistura de ordem 1 (0,35); `restBarProb` 0,22; corpus de 10 frases de 1 compasso por classe (maj/min/dom), em graus relativos ao acorde; notas em tempo forte são "encaixadas" em notas do acorde; m7b5 mapeia 7→6 e 9→8; tessitura MIDI 66–84.
- **Humanização:** swing 0,14 nas unidades ímpares, jitter ±12 ms, arpejo leve do acorde (22 ms entre notas), recomposição (comping) no contratempo do 3º tempo com p = 0,45.
- **Determinismo:** tudo vem de `createRng(seed)`; mesma seed → mesma música. "Nova semente" sorteia outra (outro tom/progressão).
- **Samples:** Salamander em `https://tonejs.github.io/audio/salamander/`, uma amostra a cada 3 semitons de C2 a C7 (arquivos usam `s` no lugar de `#`). Baixados no primeiro play (**requer internet** por enquanto).

## 5. API do `audioController`

`play()`, `pause()`, `setAmbient(kind)`, `setMusic(kind)`, `setAmbientVolume(v)`, `setMusicVolume(v)`, `newSeed()`, `setSleepTimer(min)`.

Pontos de projeto:
- Grafo criado **lazy no primeiro `play()`** (exige gesto do usuário).
- `runToken` incrementado a cada play/pause: continuações assíncronas antigas se descartam (proteção de corrida).
- `pause()`: fade-out de 0,5 s e, após 600 ms, para música e ambiente (CPU ≈ 0). `play()` dentro dessa janela cancela a parada.
- Timer de sono (15/30/60 min): fade-out de 15 s terminando no minuto marcado, depois `pause()`.
- Erros de áudio vão para `store.error` (mostrado sob o botão play).

## 6. Ambiente / chuva (redesenhado)

A primeira versão da chuva soava irreal (usuário: "não tem nada a ver com barulho de chuva"). Foi refeita:
- **Camada base procedural:** loop estéreo de 12 s (`makeRainBed`), com crossfade para emenda sem corte; micro-impactos de cauda pesada + modulação lenta de amplitude. Medido: geração 84/114 ms, RMS 0,17, correlação L/R ≈ 0,03.
- **Gotas esparsas:** agendador de Poisson (`DROP_SECONDS = 0.06`).
- **Presets:** chuva leve = bed `light` 0,55 + brown 0,04 + 3 gotas/s; chuva = bed `heavy` 0,65 + brown 0,12 + 6 gotas/s; brisa = ruído marrom com LFO no corte do filtro.

## 7. Padrões e preferências do usuário

- Comunicar em **pt-BR**.
- Construção delegada a **subagentes Haiku**, com Claude como **supervisor** (revisar, rodar tsc/testes/build).
- Não gerar arte sexualizada de personagem; o banner do README é **imagem do próprio usuário** (`docs/assets/banner.jpg`). Conteúdo adulto/sugestivo: já avisado sobre repositório público.
- Interface: o usuário escolheu usar o banner como **fundo do app** (`body::before` em `styles.css`, gradiente escuro por cima para legibilidade).
- Não quer animação no banner do README (foi removida).

## 8. Estado atual (09/11/2026)

**Feito e verificado por ferramentas:** `tsc --noEmit`, 34 testes Vitest, `vite build` e capturas de tela headless passaram.

**Alterações recentes:**
- Chuva refeita (§6).
- Fundo do app com a imagem do banner.
- **Volume padrão do ambiente = 30%** (`ambientVol: 0.3` em `src/app/store.ts`; antes 0,7). Volume da música padrão 60%. Padrões restantes: ambiente `lightRain`, música `piano`, sem timer.
  - Não rodei o `tsc` depois dessa troca (mudança de um número).

**NUNCA validado:** o áudio nunca foi ouvido por Claude (impossível em Node). Realismo da chuva e musicalidade do Markov dependem da escuta do usuário.

## 9. Pendências e pontos em aberto

1. **Escuta do usuário:** reportar realismo da chuva e musicalidade; depois ajustar parâmetros (`hissGain`, `bodyGain`, `dropRate`, gotas/s, reverb etc.).
2. **CPU acima da meta:** medido no Firefox — aba ≈ 15% de um núcleo (meta 8%), processo de GPU ≈ 20%, WindowServer ≈ 44%.
   - Hipótese 1 (visual): `backdrop-filter: blur(10px)` em `.card` + fundo fixo → proposta: **remover o `backdrop-filter`** (aguardando resposta do usuário).
   - Hipótese 2 (áudio): `JCReverb` e polifonia do `Sampler` → aliviar reverb / limitar vozes.
   - Teste de isolamento proposto: pausar; música "nenhum"; ambiente "nenhum" e comparar.
3. **Roadmap:** PWA offline (service worker/manifest), Media Session API, hospedar os samples Salamander localmente (hoje dependem do CDN), v2 Magenta com A/B.
4. **Decisões abertas** em `PLANO_CONSTRUCAO.md` §11 (licença etc.).
5. **Assets:** `banner-v1-desenho.svg` e `banner.png` foram apagados (09/11/2026). `docs/assets/banner-v2-reserva.png` (segunda imagem, reserva) foi mantido e **está versionado** no repositório, por decisão do usuário.
6. O repositório ainda não tem commits próprios do projeto (a pasta aparece como não rastreada no git do diretório pai).

## 10. Armadilhas conhecidas

- Node padrão quebrado (ver §2).
- Samples vêm de CDN externo: sem internet, `load()` falha e o erro é exibido; nova tentativa refaz o download.
- Áudio só inicia após gesto do usuário (política dos navegadores).
- Testes de DSP: evitar `expect` por amostra (lento); usar laço com uma única asserção.
- `Tone.getTransport()` é global: `MusicEngine.halt()` faz `stop` + `cancel(0)`; qualquer novo agendamento no Transport precisa levar isso em conta.
