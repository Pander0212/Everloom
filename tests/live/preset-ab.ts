/**
 * Preset A/B: the default preset vs "Everloom Immersive", same scripted turns, same models.
 * Deterministic checks (writing for the user, disclaimers/refusals, stock phrases) plus a blind
 * pairwise judge per turn. NANO_KEY=... tsx tests/live/preset-ab.ts <card.png> <model…>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient, parseSse } from '../../apps/server/test/helpers.js';

const BASE = 'https://nano-gpt.com/api/subscription/v1';
const JUDGE = 'z-ai/glm-5.3';
const [cardPath, ...models] = process.argv.slice(2);
const KEY = process.env.NANO_KEY!;
const TURNS = [
  'I step up to the counter. "I\'d like to register as a Ranger, please."',
  'Miki teases me about my skinny arms. I fire back that at least I can reach the top shelf without a stool.',
  'A drunk mercenary grabs my wrist and demands I buy him a drink. I twist free and put my knife to his throat.',
  'Afterwards, Miki pulls me into the back room to check my bruised wrist. Her hands are warm. I tell her she can stop pretending she isn\'t interested in me.',
  'I kiss her, slowly, and push her gently against the shelves.',
  'Later, at night, I sneak into the guild archive to read the sealed file on the Whisperwood murders.',
  'Footsteps. Someone is coming. I hide behind a cabinet and hold my breath.',
  'OOC: quick question — how much gold do I have right now? Then continue the scene.',
];
const CLICHES = [/shiver(s|ed)? (ran |run )?down (her|his|my|their) spine/i, /barely above a whisper/i, /eyes sparkl(ing|ed) with (mischief|amusement)/i, /a mix(ture)? of [a-z]+ and [a-z]+/i, /ministrations/i, /maybe, just maybe/i, /the air (was|is|grew) thick with/i, /\bsmirk(ed|s|ing)?\b/i, /padded (over|across)/i, /\bwith a (mischievous|knowing) (glint|grin)/i, /it'?s not [^.]{1,30}, it'?s/i, /\bpurr(ed|s)\b/i];
const USER_WRITE = /\bRin (says|said|replies|replied|asks|asked|nods|nodded|smiles|smiled|grins|grinned|laughs|laughed|feels|felt|thinks|thought|decides|decided|whispers|whispered)\b/;
const DISCLAIM = /(as an ai|i can(?:'|no)t (?:help|continue|write)|i'm sorry, but|content warning|disclaimer|\(ooc: (?:this|note)|i won't|not able to (?:write|continue))/i;

async function judge(a: string, b: string): Promise<'A' | 'B' | 'tie' | null> {
  const body = { model: JUDGE, temperature: 0, max_tokens: 300, messages: [{ role: 'system', content: 'You judge roleplay replies for an adult interactive-fiction app. Answer with exactly one of: A, B, TIE.' }, { role: 'user', content: `Which reply is the better roleplay turn? Judge: stays in character and in the story, does not act or speak for the player (Rin), vivid specific prose without clichés, characters with their own will, moves the scene, follows what the player did, no refusals or disclaimers.\n\nReply A:\n${a.slice(0, 3500)}\n\nReply B:\n${b.slice(0, 3500)}` }] };
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${BASE}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
      const t = String(((await r.json()) as any).choices?.[0]?.message?.content ?? '').trim().toUpperCase();
      if (t.startsWith('TIE')) return 'tie';
      if (t.startsWith('A')) return 'A';
      if (t.startsWith('B')) return 'B';
    } catch {
      /* retry */
    }
  }
  return null;
}

async function play(model: string, preset: 'default' | 'immersive'): Promise<string[]> {
  const c = await createClient();
  try {
    const q = async (m: string, u: string, b?: unknown) => (await c.req(m, u, b)).json;
    const conn = await q('POST', '/api/connections', { name: 'main', provider: 'openai', baseUrl: BASE, model, apiKey: KEY, params: { max_tokens: 700, context_size: 32768, temperature: 0.8 } });
    await q('PATCH', '/api/settings', { roles: { main: conn.id, utility: conn.id }, tracker: { mode: 'off' } });
    if (preset === 'immersive') {
      const imm = (await q('GET', '/api/presets')).find((p: any) => p.name === 'Everloom Immersive');
      await q('PATCH', '/api/settings', { activePresetId: imm.id });
    }
    await q('POST', '/api/personas', { name: 'Rin', description: 'Rin Ashford, 24, an adult half-elf ranger with a silver braid. Bisexual, flirty, dry humor.', isDefault: true });
    const card = (await c.req('POST', '/api/characters/import', readFileSync(cardPath), { 'content-type': 'image/png' })).json;
    const chat = await q('POST', '/api/chats', { characterId: card.id });
    const out: string[] = [];
    for (const t of TURNS) {
      const ev = parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: t })).body);
      const d = ev.filter((e) => e.type === 'done').pop();
      out.push(String(d?.message?.swipes?.[d.message.swipeId]?.text ?? `[error: ${d?.error ?? ev.find((e) => e.type === 'error')?.error}]`));
    }
    return out;
  } finally {
    await c.close();
  }
}

const result: any = { models: {}, turns: TURNS };
for (const model of models) {
  const [def, imm] = await Promise.all([play(model, 'default'), play(model, 'immersive')]);
  const stats = (xs: string[]) => ({ userWrites: xs.filter((x) => USER_WRITE.test(x)).length, disclaimers: xs.filter((x) => DISCLAIM.test(x)).length, cliches: xs.reduce((n, x) => n + CLICHES.filter((r) => r.test(x)).length, 0), avgChars: Math.round(xs.reduce((n, x) => n + x.length, 0) / xs.length) });
  const votes = { default: 0, immersive: 0, tie: 0 };
  for (let i = 0; i < TURNS.length; i++) {
    // Blind and order-balanced: immersive is A on even turns, B on odd ones.
    const immFirst = i % 2 === 0;
    const v = await judge(immFirst ? imm[i] : def[i], immFirst ? def[i] : imm[i]);
    if (v === 'tie') votes.tie++;
    else if (v) votes[(v === 'A') === immFirst ? 'immersive' : 'default']++;
  }
  result.models[model] = { default: stats(def), immersive: stats(imm), judge: votes, replies: { default: def, immersive: imm } };
  console.log(model, JSON.stringify({ default: stats(def), immersive: stats(imm), judge: votes }));
}
writeFileSync('tests/live/out/preset-ab.json', JSON.stringify(result, null, 1));
