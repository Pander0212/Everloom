#!/usr/bin/env node
// Generates one image and records it in docs/art/ledger.json (and LEDGER.md).
//
//   node tools/art/gen.mjs --service nano --model qwen-image --res 1024x1024 --label icons-a --prompt "…"
//   node tools/art/gen.mjs --service nano --model step-image-edit-2 --input base.png --prompt "…"
//   node tools/art/gen.mjs --service eh --model sdxl-novaanimexl-ilv100 --res 832x1216 --prompt "…"
//   node tools/art/gen.mjs --mark 12 kept "used for the tavern background"
//   node tools/art/gen.mjs --render
//
// Keys come from NANOGPT_API_KEY / ELECTRONHUB_API_KEY and are never printed or stored.
// Hard limits (see docs/art/PROMPTING.md): only the five NanoGPT subscription models, at most 95
// NanoGPT images per UTC day, each call checked against the subscription counter and the cash
// balance; ElectronHub standard (non-premium) models only, stopping before $2.00.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ledgerJson = path.join(root, 'docs/art/ledger.json');
const ledgerMd = path.join(root, 'docs/art/LEDGER.md');
const rawDir = process.env.ART_RAW_DIR || path.join(root, '.art-raw');

const NANO_MODELS = new Set(['hidream', 'chroma', 'z-image-turbo', 'qwen-image', 'step-image-edit-2']);
const NANO_DAILY_CAP = 95;
const EH_CAP_USD = 2.0;
const NANO = 'https://api.nano-gpt.com/api';
const EH = 'https://api.electronhub.ai/v1';

const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    service: { type: 'string' },
    model: { type: 'string' },
    prompt: { type: 'string' },
    res: { type: 'string' },
    input: { type: 'string' },
    label: { type: 'string', default: '' },
    mark: { type: 'string' },
    resume: { type: 'string' },
    render: { type: 'boolean' },
    status: { type: 'boolean' },
  },
});

const load = () => (existsSync(ledgerJson) ? JSON.parse(readFileSync(ledgerJson, 'utf8')) : { entries: [] });
const today = () => new Date().toISOString().slice(0, 10);
const nanoToday = (L) => L.entries.filter((e) => e.service === 'nano' && e.date === today() && e.counted).length;
const ehTotal = (L) => Math.round(L.entries.filter((e) => e.service === 'eh').reduce((t, e) => t + (e.costUsd || 0), 0) * 10000) / 10000;

function render(L) {
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  let nanoRun = {};
  let ehRun = 0;
  const rows = L.entries.map((e) => {
    let total;
    if (e.service === 'nano') {
      nanoRun[e.date] = (nanoRun[e.date] || 0) + (e.counted ? 1 : 0);
      total = `${nanoRun[e.date]}/${NANO_DAILY_CAP} today`;
    } else {
      ehRun += e.costUsd || 0;
      total = `$${ehRun.toFixed(3)} / $${EH_CAP_USD.toFixed(2)}`;
    }
    const cost = e.service === 'nano' ? (e.counted ? '1 image (subscription)' : '0') : `$${(e.costUsd || 0).toFixed(3)}`;
    return `| ${e.n} | ${e.date} | ${e.service === 'nano' ? 'NanoGPT' : 'ElectronHub'} | \`${e.model}\` | ${esc(e.label)} | ${esc(e.prompt)}${e.input ? ` (edit of ${esc(e.input)})` : ''} | ${cost} | ${total} | ${e.ok ? (e.kept === true ? 'kept' : e.kept === false ? 'not kept' : 'pending') : `failed: ${esc(e.error)}`}${e.note ? ` — ${esc(e.note)}` : ''} |`;
  });
  const md = `# Art ledger

Every image call, in order. Written by \`tools/art/gen.mjs\`; the source of truth is
\`ledger.json\`. NanoGPT calls are subscription-included (checked per call against the daily image
counter and the cash balance, which must not move); ElectronHub calls cost the listed per-image price.

Limits: NanoGPT at most ${NANO_DAILY_CAP} images per UTC day, only \`hidream\`, \`chroma\`, \`z-image-turbo\`,
\`qwen-image\`, \`step-image-edit-2\`. ElectronHub standard models only, stopping at $${EH_CAP_USD.toFixed(2)}.

| # | Date (UTC) | Service | Model | Purpose | Prompt | Cost / count | Running total | Kept |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
${L.stopped ? `\n**Stopped:** ${esc(L.stopped)}\n` : ''}${(L.resumed ?? []).length ? `\n## Stops and resumes\n\n${L.resumed.map((r) => `- ${r.at.slice(0, 16).replace('T', ' ')} UTC: stopped on "${esc(r.stopped)}". Resumed because: ${esc(r.why)}`).join('\n')}\n` : ''}`;
  writeFileSync(ledgerMd, md);
}
function save(L) {
  mkdirSync(path.dirname(ledgerJson), { recursive: true });
  writeFileSync(ledgerJson, JSON.stringify(L, null, 1));
  render(L);
}

async function j(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, body, text: text.slice(0, 600) };
}

async function nanoMeter(key) {
  const h = { 'x-api-key': key };
  const u = await j(`${NANO}/subscription/v1/usage`, { headers: h });
  const b = await j(`${NANO}/check-balance`, { method: 'POST', headers: h });
  if (u.status !== 200 || b.status !== 200) throw new Error(`could not read the NanoGPT meter (${u.status}/${b.status})`);
  return { used: u.body?.dailyImages?.used, limit: u.body?.limits?.dailyImages, degraded: !!u.body?.dailyImages?.degraded, usd: Number(b.body?.usd_balance), mode: u.body?.routing?.billingMode };
}

async function ehPrice(model) {
  const m = await j(`${EH}/models`);
  const row = m.body?.data?.find((x) => x.id === model);
  if (!row) throw new Error(`ElectronHub has no model "${model}"`);
  if (row.premium_model) throw new Error(`"${model}" is a premium model; only standard models are allowed`);
  if (row.pricing?.type !== 'per_image' || !(row.pricing.coefficient > 0)) throw new Error(`"${model}" has no per-image price`);
  if (!row.endpoints?.includes('/v1/images/generations')) throw new Error(`"${model}" is not an image generation model`);
  return { price: row.pricing.coefficient, sizes: row.sizes ?? [] };
}

function imageOut(body) {
  const d = body?.data?.[0] ?? body?.images?.[0] ?? null;
  if (!d) return null;
  if (typeof d === 'string') return d.startsWith('http') ? { url: d } : { b64: d.replace(/^data:[^,]+,/, '') };
  if (d.b64_json) return { b64: d.b64_json };
  if (d.url) return d.url.startsWith('data:') ? { b64: d.url.replace(/^data:[^,]+,/, '') } : { url: d.url };
  return null;
}

async function saveImage(out, file) {
  let buf;
  if (out.b64) buf = Buffer.from(out.b64, 'base64');
  else {
    const r = await fetch(out.url);
    if (!r.ok) throw new Error(`download failed (${r.status})`);
    buf = Buffer.from(await r.arrayBuffer());
  }
  mkdirSync(rawDir, { recursive: true });
  const ext = buf[0] === 0x89 ? 'png' : buf[0] === 0xff ? 'jpg' : buf.slice(8, 12).toString() === 'WEBP' ? 'webp' : 'bin';
  const p = path.join(rawDir, `${file}.${ext}`);
  writeFileSync(p, buf);
  return p;
}

async function main() {
  const L = load();
  if (a.render) return render(L);
  if (a.status) {
    console.log(JSON.stringify({ nanoToday: nanoToday(L), nanoCap: NANO_DAILY_CAP, ehTotal: ehTotal(L), ehCap: EH_CAP_USD, entries: L.entries.length }));
    return;
  }
  if (a.resume) {
    // Clears a stop after checking it wasn't a charge or quota error; the reason is kept.
    (L.resumed ??= []).push({ at: new Date().toISOString(), stopped: L.stopped ?? null, why: a.resume });
    delete L.stopped;
    save(L);
    return;
  }
  if (a.mark) {
    const e = L.entries.find((x) => x.n === Number(a.mark));
    if (!e) throw new Error('no such entry');
    e.kept = positionals[0] === 'kept';
    if (positionals[1]) e.note = positionals[1];
    save(L);
    return;
  }
  if (!a.service || !a.model || !a.prompt) throw new Error('need --service, --model and --prompt');
  if (L.stopped) throw new Error(`stopped earlier: ${L.stopped}`);
  const n = (L.entries.at(-1)?.n ?? 0) + 1;
  const entry = { n, date: today(), at: new Date().toISOString(), service: a.service, model: a.model, label: a.label, prompt: a.prompt, res: a.res ?? null, input: a.input ? path.basename(a.input) : null, ok: false, counted: false, costUsd: 0, kept: null };
  const fileBase = `${String(n).padStart(3, '0')}-${a.service}-${a.model}-${(a.label || 'x').replace(/[^a-z0-9-]+/gi, '_')}`;

  if (a.service === 'nano') {
    if (!NANO_MODELS.has(a.model)) throw new Error(`"${a.model}" is not on the allowed NanoGPT list`);
    if (nanoToday(L) >= NANO_DAILY_CAP) throw new Error(`NanoGPT daily cap (${NANO_DAILY_CAP}) reached for ${today()}`);
    const key = process.env.NANOGPT_API_KEY;
    if (!key) throw new Error('NANOGPT_API_KEY is not set');
    const before = await nanoMeter(key);
    if (before.mode !== 'subscription_only') throw new Error(`refusing: the key's billing mode is "${before.mode}", not subscription_only`);
    if (before.used == null || before.degraded) throw new Error('refusing: the subscription image counter is unavailable');
    if (before.used >= NANO_DAILY_CAP) throw new Error(`refusing: ${before.used} images already used today`);
    const body = { model: a.model, prompt: a.prompt, n: 1 };
    let url = `${NANO}/v1/images`;
    if (a.input) {
      const buf = readFileSync(a.input);
      const mime = buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : 'image/webp';
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      // The normalized endpoint ignored input_references for the edit model (calls #40-#43 drew
      // a stranger at 1024x1024); the edits endpoint takes the picture as imageDataUrl and
      // refuses a request without it.
      url = `${NANO}/v1/images/edits`;
      body.imageDataUrl = dataUrl;
    } else if (a.res) body.resolution = a.res;
    const r = await j(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body) });
    const after = await nanoMeter(key);
    entry.meter = { usedBefore: before.used, usedAfter: after.used, usdBefore: before.usd, usdAfter: after.usd };
    const charged = Number.isFinite(before.usd) && Number.isFinite(after.usd) && after.usd < before.usd - 1e-9;
    entry.counted = after.used > before.used;
    if (charged) {
      entry.error = `cash balance moved ${before.usd} → ${after.usd}`;
      L.stopped = `NanoGPT charged the balance on call #${n} (${entry.error})`;
    }
    if (r.status !== 200) {
      const msg = typeof r.body?.error === 'string' ? r.body.error : r.body?.error?.message ?? r.body?.message ?? r.text;
      entry.error = `HTTP ${r.status}: ${String(msg).slice(0, 200)}${r.body?.code ? ` (${r.body.code})` : ''}`;
      // A charge or quota refusal stops everything; a transient outage (503, 429) doesn't.
      if (r.status === 402 || /quota|insufficient|payment|balance|exceeded|daily.?limit|subscription/i.test(`${msg} ${r.body?.code ?? ''}`)) L.stopped = `NanoGPT refused on call #${n}: ${entry.error}`;
    } else {
      const out = imageOut(r.body);
      if (!out) entry.error = `no image in the response: ${r.text}`;
      else {
        const saved = await saveImage(out, fileBase);
        entry.file = path.basename(saved);
        entry.ok = !charged;
        if (a.input && a.model === 'step-image-edit-2') {
          // A real edit comes back at the input's size; anything else means the input was ignored.
          const { default: sharp } = await import('sharp');
          const [i, o] = await Promise.all([sharp(a.input).metadata(), sharp(saved).metadata()]);
          if (i.width !== o.width || i.height !== o.height) entry.warning = `output ${o.width}x${o.height} differs from input ${i.width}x${i.height}: the input may have been ignored`;
        }
      }
      if (!entry.counted && !charged) L.stopped = `call #${n} returned but the subscription counter did not move; stopping to be safe`;
    }
  } else if (a.service === 'eh') {
    const key = process.env.ELECTRONHUB_API_KEY;
    if (!key) throw new Error('ELECTRONHUB_API_KEY is not set');
    const { price, sizes } = await ehPrice(a.model);
    if (ehTotal(L) + price > EH_CAP_USD + 1e-9) throw new Error(`ElectronHub cap: $${ehTotal(L)} spent, this call ($${price}) would pass $${EH_CAP_USD}`);
    if (a.res && sizes.length && !sizes.includes(a.res)) throw new Error(`size ${a.res} not offered (${sizes.join(', ')})`);
    const body = { model: a.model, prompt: a.prompt, n: 1, response_format: 'b64_json', ...(a.res ? { size: a.res } : {}) };
    // Count the price before the call: a timeout after the provider ran still costs money.
    entry.costUsd = price;
    const r = await j(`${EH}/images/generations`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    if (r.status !== 200) {
      entry.error = `HTTP ${r.status}: ${String(r.body?.error?.message ?? r.text).slice(0, 200)}`;
      if ([400, 404, 422].includes(r.status)) entry.costUsd = 0; // rejected before generation
      if (r.status === 402 || /credit|insufficient|payment|balance|quota/i.test(entry.error)) L.stopped = `ElectronHub refused on call #${n}: ${entry.error}`;
    } else {
      const out = imageOut(r.body);
      if (!out) entry.error = `no image in the response: ${r.text}`;
      else {
        entry.file = path.basename(await saveImage(out, fileBase));
        entry.ok = true;
      }
    }
  } else throw new Error('--service must be nano or eh');

  L.entries.push(entry);
  save(L);
  console.log(JSON.stringify({ n, ok: entry.ok, file: entry.file ?? null, error: entry.error ?? null, warning: entry.warning ?? null, nanoToday: nanoToday(L), ehTotal: ehTotal(L), stopped: L.stopped ?? null }));
  if (!entry.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
