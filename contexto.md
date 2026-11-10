# Contexto — Auto Rainjazz

> Documento de continuidade: o que o projeto é, como está construído, o que foi decidido, o que já foi verificado e o que falta. Atualizado em 09/11/2026 (segunda rodada: violino, chuva nova, correções).
> Detalhes complementares: `PLANO_CONSTRUCAO.md` (plano e roadmap), `docs/spec-v1.md` (contratos entre módulos, versão v1 original), `README.md` (apresentação).

## 1. O que é

App web leve que **gera jazz suave (piano, opcionalmente com violino) em tempo real, no próprio dispositivo**, sobre um **ruído ambiente** selecionável (Nenhum / Brisa / Chuva leve / Chuva). Inspiração: canais de YouTube "Jazz relaxante + barulho de chuva para concentração".

- **v1 (construída):** harmonia por regras + voice leading + melodia Markov de ordem 2 + piano Salamander + violino (samples locais).
- **v2 (opcional, não iniciada):** melodia por rede neural (Magenta/TF.js) com comparação A/B contra o Markov. Só entra se o Markov soar limitado.
- **Restrição principal:** leve. Sem TF.js no bundle base; CPU baixa (meta: < ~8% de um núcleo).

## 2. Stack e ambiente

| Item | Escolha |
|---|---|
| Build | Vite 8, TypeScript 7 (strict, **sem `any`**) |
| UI | Preact 11 (+ `@preact/preset-vite`) |
| Estado | Zustand vanilla + `persist` (`src/app/store.ts`) com hook próprio `useStore` (sem `preact/compat`) |
| Áudio | Tone.js 15 |
| Testes | Vitest 5 (`tests/**/*.test.ts`, ambiente node) |
| CI | GitHub Actions (`.github/workflows/ci.yml`): typecheck + test + build, Node 22 |

**Atenção ao Node:** o `node` padrão da máquina (v26) está quebrado (falta `libsimdjson.33` do Homebrew). Usar sempre:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm run dev          # servidor de desenvolvimento
npm run build        # tsc --noEmit && vite build
npm test             # vitest run
npm run typecheck
```

Sugestão já dada ao usuário: `brew reinstall node` para consertar o Node padrão.

## 3. Arquitetura

```
src/
  main.tsx, app/
    App.tsx        UI: botão play, seletores de ambiente/música, sliders, timer de sono, nova semente
    store.ts       AppState + store (persist em localStorage) + useStore
    types.ts       AmbientKind, MusicKind ('none' | 'piano' | 'pianoViolin'), SleepMin
  audio/
    audioController.ts   API pública do áudio (ver §5)
    ambient/
      ambientEngine.ts   brisa (ruídos + LFO) e chuva (baixa/decodifica a gravação, toca em loop)
      presets.ts         PRESETS (nenhum/brisa/chuva leve/chuva), centerOf/depthOf — puro
      dsp.ts             makeSeamlessLoop (emenda do loop por crossfade) — puro
    music/
      musicEngine.ts     agenda 1 compasso por vez no Transport; Lineup 'piano' | 'pianoViolin'
      violinLine.ts      papel do violino, legato, notas-guia — puro
      voicing.ts         voice leading (movimento total mínimo)
      harmony/           progressions.ts, harmonyGenerator.ts, types.ts
      melody/            corpus.ts, markovMelody.ts, types.ts
      instruments/       piano.ts (Sampler -> Filter 5200), violin.ts (Sampler -> Filter 4200)
      theory/            notes.ts, chords.ts
  lib/prng.ts            mulberry32 (aleatoriedade determinística por seed)
  assets/bg.jpg          fundo do app (313 KB); também artwork da Media Session
  styles.css
public/samples/          salamander/ (21 mp3, 1,3 MB), violin/ (12 mp3, 720 KB)
public/ambient/          chuva-leve.mp3, chuva-forte.mp3 (~59 s, 128 kbps estéreo, ~925 KB cada)
tests/   dsp, harmony, markov, voicing, violin  (33 testes)
docs/    spec-v1.md, assets/ (banner)
```

### Grafo de áudio

```
Piano:   Sampler -> Filter(lowpass 5200) ─┐
Violino: Sampler -> Filter(lowpass 4200) ─┴-> JCReverb (roomSize 0.5, wet 0.3; o mesmo da v1) -> musicBus
Ambiente: gravação de chuva em loop / ruídos da brisa -> ambientBus
musicBus + ambientBus -> master Gain (começa em 0; fade-in/out) -> Limiter(-1 dB) -> destino
```

Volume do slider → ganho por curva **quadrática** (`v²`): 30% no slider ≈ 9% de ganho real.

## 4. Música (regras)

- Compasso = 8 "unidades" (colcheias); tempos fortes = unidades 0 e 4. Transport com `scheduleRepeat('1m')`, BPM 56–72 (sorteado pela seed).
- **Harmonia:** templates de 4 compassos (ii–V–I etc.); troca de tonalidade com p = 0,5.
- **Voicings:** shell (3ª + 7ª + extensão) + baixo na batida 1; **voice leading** = escolher a inversão que minimiza o movimento total em relação ao acorde anterior.
- **Melodia Markov:** ordem 2 com mistura de ordem 1 (0,35); `restBarProb` 0,22; corpus de 10 frases de 1 compasso por classe (maj/min/dom), em graus relativos ao acorde; notas em tempo forte são "encaixadas" em notas do acorde; m7b5 mapeia 7→6 e 9→8; tessitura MIDI 66–84.
- **Violino (formação "Piano + violino"):** a cada ciclo de 4 compassos sorteia um papel (rng próprio, `seed ^ 0x7f4a7c15`):
  - `lead` (0,5): o violino toca a melodia Markov em **legato** (cada nota vai até a próxima) e o piano só acompanha;
  - `pad` (0,35): o piano toca a melodia e o violino sustenta **notas-guia** (3ª/7ª/9ª, nota comum mantida com p = 0,4, às vezes 2 por compasso), por voice leading, MIDI 62–81;
  - `rest` (0,15): violino em silêncio.
  - Trocar piano ↔ piano + violino com a música tocando vale a partir do próximo compasso (`setLineup`), sem reiniciar.
- **Humanização:** swing 0,14 nas unidades ímpares, jitter ±12 ms, arpejo leve do acorde (22 ms entre notas), recomposição (comping) no contratempo do 3º tempo com p = 0,45.
- **Determinismo:** tudo vem de `createRng(seed)`; mesma seed + mesma formação → mesma música. "Nova semente" sorteia outra.
- **Samples locais** em `public/samples/` (antes vinham do CDN `tonejs.github.io`):
  - Salamander: um a cada 3 semitons de C2 a C7 (arquivos usam `s` no lugar de `#`).
  - Violino: tonejs-instruments (CC-BY 3.0), G3–E6 em terças, cortados para 6 s com fade, mono 80 kbps. Os originais são ~16 dB mais altos que o piano, por isso `volume: -12` no Sampler; `attack` 0,09 s (arcada suave), `release` 0,7 s.

## 5. API do `audioController`

`play()`, `pause()`, `setAmbient(kind)`, `setMusic(kind)`, `setAmbientVolume(v)`, `setMusicVolume(v)`, `newSeed()`, `setSleepTimer(min)`.

Pontos de projeto:
- Grafo criado **lazy no primeiro `play()`** (exige gesto do usuário). Cada `play()` chama `Tone.start()` dentro do gesto para retomar um contexto suspenso.
- `runToken` incrementado a cada play/pause: continuações assíncronas antigas se descartam (proteção de corrida).
- `syncMusic()` é o único caminho que inicia/troca a música: carrega os samples da formação e, **depois de cada espera, confere de novo** token, `playing` e a escolha atual. Corrigido: trocar para "Nenhuma" durante o carregamento não liga mais a música; trocar o ambiente durante o carregamento vale na hora (`playing` vira true antes do download dos samples).
- `pause()`: fade-out de 0,5 s e, após 600 ms, para música e ambiente (CPU ≈ 0). `play()` dentro dessa janela cancela a parada.
- Timer de sono (15/30/60 min): fade-out de 15 s terminando no minuto marcado, depois `pause()`. Corrigido: mudar o timer durante esse fade devolve o volume (antes ficava "tocando" em silêncio).
- Se o sistema suspender/interromper o contexto (iOS, chamada), o `statechange` chama `pause()` para a tela não mentir.
- Media Session: metadados + play/pause/stop. Só aparece onde o navegador expõe controles para Web Audio (no Chrome, normalmente só com `<audio>`; ver §9).
- Erros de áudio vão para `store.error` (mostrado sob o botão play).
- Preferências salvas em `localStorage` (chave `auto-rainjazz:prefs`, versão 1): ambiente, música, volumes, timer. Valores inválidos/antigos são descartados no `merge`.

## 6. Ambiente / chuva: gravações reais (09/11/2026)

**Histórico (não repetir):** três chuvas **sintetizadas** foram reprovadas pelo usuário. v1 "não tem nada a ver com barulho de chuva"; v2 (ruído branco em banda + cliques + gotas com seno) "poderia ser mais real e suave"; v3 (ruído rosa + 500–1600 microgotas/s + gotas 'pat'/'plink', gerada em Web Worker) "ESTÁ UMA MERDA". Conclusão: **chuva procedural não convence; usar gravação.** A v3 nunca foi commitada.

Agora:
- **Chuva leve:** "rain on leaves", Gravity Sound (Wikimedia Commons, **CC BY 4.0**). Trecho 1–60,2 s (evita gotas fortes em 64–67 s), passa-altas 110 Hz (tinha muito grave < 150 Hz, provável vento no microfone), +8 dB com limitador em −2 dB (crest original 23,5 dB).
- **Chuva (forte):** "October rain in Nepal", Nirmal Dulal (Wikimedia Commons, **CC BY-SA 4.0**; o arquivo editado continua BY-SA, o código continua MIT). Emenda 0,5–26,2 s + 27,2–60,8 s (remove um pico em 26,4–26,9 s), passa-altas 70 Hz, −1 dB com limitador em −2 dB.
- Ambas: MP3 128 kbps estéreo 44,1 kHz, média ~−23 dB, pico −2,4 dB. Originais e intermediários ficaram só no scratchpad da sessão (re-baixáveis do Commons).
- **No navegador:** `fetch` + `decodeAudioData`, corta 60 ms em cada ponta (preenchimento do MP3), `makeSeamlessLoop` com crossfade de potência igual de 1,5 s, toca em loop com fade-in de 1 s quando fica pronta. Cache por intensidade; falha → aviso na tela (`MSG_ERRO_CHUVA`) e nova tentativa na próxima escolha.
- **Presets:** chuva leve = gravação leve × 0,8; chuva = gravação forte × 0,9; **sem** ruído sintético nem gotas artificiais por cima. Brisa continua sintetizada (ruído marrom + LFO + um pouco de rosa) e os ruídos só rodam quando a brisa está ativa.
- Candidatas descartadas (análise objetiva): "Rain drops" (Gravity Sound; gotas grandes pingando, nível oscilando 11 dB), "Rain Rain Rain" (Antti Luode; o próprio arquivo repete a cada 10 s), "Rain against the window" (mono, batidas), "Regen in de tent" (chuva em lona), Bourne Woods (vento e pássaros), Glenshaw (gravada em celular).

## 7. Padrões e preferências do usuário

- Comunicar em **pt-BR**.
- Construção delegada a **subagentes Haiku**, com Claude como **supervisor** (revisar, rodar tsc/testes/build).
- Não gerar arte sexualizada de personagem; o banner do README é **imagem do próprio usuário** (`docs/assets/banner.jpg`). Conteúdo adulto/sugestivo: já avisado sobre repositório público.
- Interface: o usuário escolheu usar o banner como **fundo do app** (`body::before` em `styles.css`, gradiente escuro por cima para legibilidade).
- Não quer animação no banner do README (foi removida).

## 8. Estado atual (09/11/2026)

**Reação do usuário à segunda rodada:** reprovou a chuva v3 **e o som do piano**. O piano só tinha mudado no reverb (JCReverb → Tone.Reverb de convolução); **voltou ao JCReverb original** (piano idêntico à v1 no modo "Piano"). A chuva virou gravação real (§6). **Escuta do usuário depois disso: "boa melhorou"** (chuva gravada + piano com JCReverb aprovados). Ainda sem retorno específico sobre o violino.

**Feito e verificado por ferramentas:** `tsc --noEmit`, 33 testes Vitest, `vite build` e teste no Chromium via Playwright (as duas gravações de chuva carregam, decodificam e tocam estáveis, sem erro). Da rodada anterior:
- todos os samples carregam do próprio app (200), o worker carrega e o contexto fica `running`;
- a saída tem sinal (≈ −40 dBFS RMS com chuva 30% + música 60%);
- trocar para piano + violino com a música tocando funciona;
- suspender o contexto por fora → botão volta a "Tocar"; play retoma;
- com o download dos samples atrasado em 3 s, escolher "Nenhuma" durante o carregamento → Transport parado, chuva tocando;
- preferências sobrevivem ao recarregar.

**Alterações desta rodada:** violino; chuva por gravação real; `JCReverb` agora compartilhado por piano e violino (mesmo som da v1); `backdrop-filter` removido dos cartões (fundo 0,88 opaco); samples locais; correções do controlador (§5); preferências salvas; Media Session; README alinhado com o que existe; CI.

**NUNCA validado:** o áudio nunca foi ouvido por Claude. Realismo da chuva, equilíbrio piano × violino e musicalidade dependem da escuta do usuário.

## 9. Pendências e pontos em aberto

1. **Escuta do usuário:** chuva gravada (níveis em `presets.ts`: `bedGain`), violino (`VOLUME_DB` em `violin.ts`; papéis em `violinLine.ts`). Se o violino não agradar, a opção "Piano" é idêntica à v1.
2. **CPU:** medir de novo. O blur dos cartões saiu. O `JCReverb` (4 AudioWorklets em JS) **ficou**, porque o substituto por convolução foi reprovado de ouvido; se a CPU continuar alta, testar outro reverb **com aprovação do usuário por escuta**. Medição anterior no Firefox: aba ≈ 15% de um núcleo (meta 8%), GPU ≈ 20%, WindowServer ≈ 44%.
3. **Media Session de verdade / iOS:** rotear a saída por `MediaStreamDestination` → `<audio>` faria os controles aparecerem no Chrome e também tocaria com o iPhone no silencioso e em segundo plano. Não feito (muda o caminho de todo o áudio; precisa de teste em aparelho).
4. **Roadmap:** PWA offline (service worker + manifest; os samples já são locais), v2 Magenta com A/B, cello, trovão.
5. **Decisões abertas** em `PLANO_CONSTRUCAO.md` §11.
6. **Assets:** `docs/assets/banner-v2-reserva.png` (2,2 MB, reserva) continua versionado, por decisão do usuário.
7. Falta `favicon.ico` (404 no console; inofensivo).

## 10. Armadilhas conhecidas

- Node padrão quebrado (ver §2).
- Áudio só inicia após gesto do usuário (política dos navegadores).
- Testes de DSP: evitar `expect` por amostra (lento); usar laço com uma única asserção.
- `Tone.getTransport()` é global: `MusicEngine.halt()` faz `stop` + `cancel(0)`; qualquer novo agendamento no Transport precisa levar isso em conta.
- Com o `persist` do Zustand, `store.setState` não retorna `void` (o tipo muda); envolver em bloco quando a função for tipada como `void`.
- Mudanças de **timbre** (reverb, chuva, instrumento) não podem ser validadas por ferramentas: medir nível/espectro só garante que há som, não que soa bem. Fazer uma de cada vez e pedir escuta antes de empilhar outra.
- Os downloads do Wikimedia Commons (upload.wikimedia.org) devolvem HTTP 429 se forem rápidos demais; espaçar ~8 s.
