/**
 * Funções puras do ambiente sonoro. Sem Tone.js e sem DOM, para serem testáveis em Node.
 */

/**
 * Transforma um trecho de áudio (um array por canal) num loop sem emenda.
 *
 * Com N = comprimento − F (F = `crossfadeS`·sr), devolve N amostras por canal: no
 * início, a cauda `x[N..N+F)` é misturada com potência igual (para sinais tipo
 * ruído, como chuva) ao começo `x[0..F)`; o resto é copiado. Assim, ao repetir,
 * `out[N−1] = x[N−1]` é seguido por `out[0] = x[N]`, que é o vizinho natural.
 *
 * Fazer a emenda aqui, depois de decodificar, evita depender do preenchimento que
 * cada navegador põe no início e no fim de um MP3.
 */
export function makeSeamlessLoop(
  channels: readonly Float32Array[],
  sampleRate: number,
  crossfadeS: number,
): Float32Array<ArrayBuffer>[] {
  const length = channels[0]?.length ?? 0
  const F = Math.min(Math.round(crossfadeS * sampleRate), Math.floor(length / 2))
  const N = length - F
  return channels.map((x) => {
    const out = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      if (i < F) {
        const w = i / F
        out[i] = (x[i] as number) * Math.sqrt(w) + (x[N + i] as number) * Math.sqrt(1 - w)
      } else {
        out[i] = x[i] as number
      }
    }
    return out
  })
}
