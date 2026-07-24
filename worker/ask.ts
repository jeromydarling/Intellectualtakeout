/**
 * "Ask the Archive": semantic search + question answering over all articles.
 *
 * Index build (admin): POST /api/ask/embed?chunk=N embeds one corpus chunk
 * (Workers AI bge-base-en-v1.5, L2-normalized, int8-quantized) into R2 as
 * ask-index/chunk-NNN.bin; POST /api/ask/build concatenates chunks into
 * ask-index/index.bin + meta.json.
 *
 * Query: GET /api/ask?q=...          -> top semantic matches
 *        GET /api/ask?q=...&answer=1 -> matches + an answer synthesized from
 *                                       them (Workers AI), with citations.
 */
import { Env, json, checkAdminToken, fetchCorpusChunk, fetchCorpusManifest, getConfig, setConfig } from './lib';

const DIMS = 768;
const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
const ANSWER_MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct'];

interface AskMeta {
  version: string;
  docs: { url: string; title: string; author: string; pubDate: string; chunk: number; idx: number }[];
}

// Isolate-global cache of the loaded index.
let cachedIndex: { version: string; vectors: Int8Array; scales: Float32Array; meta: AskMeta } | null = null;

function embedText(doc: { title: string; description: string; body: string }): string {
  return `${doc.title}\n${doc.description}\n${doc.body.slice(0, 1200)}`;
}

function quantize(vec: number[]): { q: Int8Array; scale: number } {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  let max = 0;
  const n = vec.map((v) => {
    const x = v / norm;
    if (Math.abs(x) > max) max = Math.abs(x);
    return x;
  });
  const scale = max / 127 || 1;
  const q = new Int8Array(vec.length);
  for (let i = 0; i < n.length; i++) q[i] = Math.round(n[i] / scale);
  return { q, scale };
}

export async function askEmbedChunk(request: Request, env: Env, url: URL): Promise<Response> {
  if (!(await checkAdminToken(request, env, url))) return json({ error: 'unauthorized' }, 401);
  const n = Number(url.searchParams.get('chunk'));
  if (!Number.isInteger(n) || n < 0) return json({ error: 'bad_chunk' }, 400);
  const existing = await env.MEDIA.head(`ask-index/chunk-${String(n).padStart(3, '0')}.bin`);
  if (existing && !url.searchParams.get('force')) return json({ ok: true, chunk: n, skipped: 'exists' });

  const docs = await fetchCorpusChunk(env, n);
  if (!docs) return json({ error: 'chunk_not_found' }, 404);

  // 8 texts per AI call keeps request sizes comfortable.
  const vectors: number[][] = [];
  for (let i = 0; i < docs.length; i += 8) {
    const batch = docs.slice(i, i + 8).map(embedText);
    const res = (await env.AI.run(EMBED_MODEL, { text: batch })) as { data: number[][] };
    vectors.push(...res.data);
  }

  // layout per doc: DIMS int8 + 1 float32 scale
  const buf = new ArrayBuffer(docs.length * (DIMS + 4));
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  docs.forEach((_, i) => {
    const { q, scale } = quantize(vectors[i]);
    bytes.set(new Uint8Array(q.buffer), i * (DIMS + 4));
    dv.setFloat32(i * (DIMS + 4) + DIMS, scale, true);
  });
  await env.MEDIA.put(`ask-index/chunk-${String(n).padStart(3, '0')}.bin`, buf);
  return json({ ok: true, chunk: n, embedded: docs.length });
}

export async function askBuildIndex(request: Request, env: Env, url: URL): Promise<Response> {
  if (!(await checkAdminToken(request, env, url))) return json({ error: 'unauthorized' }, 401);
  const manifest = await fetchCorpusManifest(env);
  if (!manifest) return json({ error: 'no_manifest' }, 500);

  const parts: ArrayBuffer[] = [];
  const meta: AskMeta = { version: manifest.generatedAt, docs: [] };
  for (let n = 0; n < manifest.chunks; n++) {
    const obj = await env.MEDIA.get(`ask-index/chunk-${String(n).padStart(3, '0')}.bin`);
    if (!obj) return json({ error: 'missing_chunk', chunk: n }, 409);
    parts.push(await obj.arrayBuffer());
    const docs = await fetchCorpusChunk(env, n);
    if (!docs) return json({ error: 'missing_corpus_chunk', chunk: n }, 409);
    docs.forEach((d, idx) =>
      meta.docs.push({ url: d.url, title: d.title, author: d.author, pubDate: d.pubDate, chunk: n, idx })
    );
  }
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { merged.set(new Uint8Array(p), off); off += p.byteLength; }
  await env.MEDIA.put('ask-index/index.bin', merged.buffer);
  await env.MEDIA.put('ask-index/meta.json', JSON.stringify(meta));
  await setConfig(env, 'ask_index_version', manifest.generatedAt);
  cachedIndex = null;
  return json({ ok: true, documents: meta.docs.length, bytes: total });
}

async function loadIndex(env: Env): Promise<typeof cachedIndex> {
  const version = (await getConfig(env, 'ask_index_version')) ?? '';
  if (cachedIndex && cachedIndex.version === version) return cachedIndex;
  const [bin, metaObj] = await Promise.all([env.MEDIA.get('ask-index/index.bin'), env.MEDIA.get('ask-index/meta.json')]);
  if (!bin || !metaObj) return null;
  const buf = await bin.arrayBuffer();
  const meta = (await metaObj.json()) as AskMeta;
  const stride = DIMS + 4;
  const count = meta.docs.length;
  const vectors = new Int8Array(count * DIMS);
  const scales = new Float32Array(count);
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  for (let i = 0; i < count; i++) {
    vectors.set(bytes.subarray(i * stride, i * stride + DIMS), i * DIMS);
    scales[i] = dv.getFloat32(i * stride + DIMS, true);
  }
  cachedIndex = { version, vectors, scales, meta };
  return cachedIndex;
}

export async function ask(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 300);
  const wantAnswer = url.searchParams.get('answer') === '1';
  if (!q) return json({ query: q, results: [] });

  const index = await loadIndex(env);
  if (!index) return json({ error: 'index_not_built' }, 503);

  const emb = (await env.AI.run(EMBED_MODEL, { text: [q] })) as { data: number[][] };
  const { q: qv, scale: qs } = quantize(emb.data[0]);

  const count = index.meta.docs.length;
  const scores = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let dot = 0;
    const base = i * DIMS;
    for (let d = 0; d < DIMS; d++) dot += index.vectors[base + d] * qv[d];
    scores[i] = dot * index.scales[i] * qs;
  }
  const order = [...scores.keys()].sort((a, b) => scores[b] - scores[a]).slice(0, 12);
  const results = order.map((i) => ({ ...index.meta.docs[i], score: Math.round(scores[i] * 1000) / 1000 }));

  if (!wantAnswer) return json({ query: q, results }, 200, { 'cache-control': 'public, max-age=3600' });

  // Answer synthesis from the top matches, citations required.
  const top = results.slice(0, 5);
  const excerpts: string[] = [];
  for (const r of top) {
    const docs = await fetchCorpusChunk(env, r.chunk);
    const body = docs?.[r.idx]?.body?.slice(0, 2200) ?? '';
    excerpts.push(`[${excerpts.length + 1}] "${r.title}" by ${r.author} (${r.pubDate.slice(0, 10)})\n${body}`);
  }
  const system = `You answer questions using ONLY the provided Intellectual Takeout article excerpts. Cite sources inline as [1], [2] etc. matching the numbered excerpts. If the excerpts do not address the question, say the archive doesn't directly address it and summarize the closest related pieces. Be concise: 2-4 short paragraphs, no preamble.`;
  let answer = '';
  for (const model of ANSWER_MODELS) {
    try {
      const res = (await env.AI.run(model as any, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Question: ${q}\n\nExcerpts:\n\n${excerpts.join('\n\n')}` },
        ],
        max_tokens: 700,
      })) as { response?: string };
      if (res.response) { answer = res.response.trim(); break; }
    } catch (e) {
      console.error('answer model failed', model, (e as Error).message);
    }
  }
  return json({ query: q, results, answer, sources: top.map((t, i) => ({ n: i + 1, url: t.url, title: t.title })) });
}

/** Nearest neighbors for an article URL — powers semantic "Read More". */
export async function related(env: Env, url: URL): Promise<Response> {
  const path = url.searchParams.get('url') ?? '';
  const index = await loadIndex(env);
  if (!index) return json({ error: 'index_not_built' }, 503);
  const i = index.meta.docs.findIndex((d) => d.url === path);
  if (i < 0) return json({ results: [] });
  const base = i * DIMS;
  const count = index.meta.docs.length;
  const scores = new Float32Array(count);
  for (let j = 0; j < count; j++) {
    if (j === i) continue;
    let dot = 0;
    const b2 = j * DIMS;
    for (let d = 0; d < DIMS; d++) dot += index.vectors[base + d] * index.vectors[b2 + d];
    scores[j] = dot * index.scales[i] * index.scales[j];
  }
  const order = [...scores.keys()].filter((j) => j !== i).sort((a, b) => scores[b] - scores[a]).slice(0, 6);
  return json(
    { results: order.map((j) => index.meta.docs[j]) },
    200,
    { 'cache-control': 'public, max-age=86400' }
  );
}
