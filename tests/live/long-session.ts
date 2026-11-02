/**
 * Long-horizon memory: ~150 turns with a deliberately small context window (8k), so everything
 * planted in the first turns has left the visible history long before it is asked about. ECHO vs
 * Everloom's legacy memory, English or German. Recall answers are judged by a separate model.
 *
 *   NANO_KEY=... EH_KEY=... tsx tests/live/long-session.ts <card.png> <lang:en|de> <echo:on|off> <model> [fillerTurns]
 */
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createClient, parseSse } from '../../apps/server/test/helpers.js';

const NANO = 'https://nano-gpt.com/api/subscription/v1';
const EH = 'https://api.electronhub.ai/v1';
const JUDGE = 'z-ai/glm-5.3';
const UTILITY = 'deepseek/deepseek-v4.1-flash-1017';
const [cardPath, lang, echoArg, model, fillerArg = '120'] = process.argv.slice(2);
const KEY = process.env.NANO_KEY!;
const EH_KEY = process.env.EH_KEY;
const de = lang === 'de';

interface Fact { id: string; plant: string; ask: string; expect: string; secret?: { who: string } }
const FACTS: Fact[] = de
  ? [
      { id: 'promise', plant: 'Ich sehe Miki fest an. "Ich verspreche dir, ich bringe dir bis zum Erntefest drei Wolfsfelle."', ask: 'Ich frage Miki: "Weißt du noch, was ich dir damals versprochen habe?"', expect: 'drei Wolfsfelle bis zum Erntefest' },
      { id: 'pet', plant: 'Ich kaufe auf dem Markt einen kleinen grauen Raben und taufe ihn "Nebelfeder".', ask: 'Ich überlege, wie ich meinen Raben damals genannt habe, und rufe ihn beim Namen.', expect: 'Nebelfeder' },
      { id: 'scar', plant: 'Als Miki nach der Narbe an meinem Kinn fragt, erzähle ich ihr, dass ein Greif mich als Kind gekratzt hat.', ask: 'Miki fragt, ob ich ihr die Geschichte meiner Kinnnarbe noch einmal erzähle. Ich bitte sie, sich selbst zu erinnern.', expect: 'ein Greif hat sie als Kind gekratzt' },
      { id: 'debt', plant: 'Ich leihe mir vom Schmied Borin zwanzig Silbermünzen und verspreche, sie bis zum Vollmond zurückzuzahlen.', ask: 'Ich gehe zum Schmied Borin. Er sieht mich an — was schulde ich ihm eigentlich noch?', expect: 'zwanzig Silbermünzen bis Vollmond' },
      { id: 'food', plant: 'Ich erzähle Miki, dass mein Lieblingsessen gebratene Pilze mit Honig sind.', ask: 'Miki will mich zum Essen einladen. Ich frage sie, ob sie noch weiß, was ich am liebsten esse.', expect: 'gebratene Pilze mit Honig' },
      { id: 'lie', plant: 'Miki fragt, woher ich komme. Ich lüge: "Aus Lowmere, einem Fischerdorf im Süden."', ask: 'Miki fragt beiläufig nach meiner Heimat. Ich bitte sie, mir zu sagen, was ich ihr damals erzählt habe.', expect: 'Lowmere, Fischerdorf im Süden' },
      { id: 'secret', plant: 'Ich flüstere dem einarmigen Zwerg auf dem Balkon zu, so leise, dass es niemand sonst hört: "Ich bin auf der Erde gestorben und hier aufgewacht."', ask: 'Ich frage Miki ganz direkt: "Hat dir irgendjemand erzählt, woher ich wirklich komme?"', expect: 'Rin died on Earth and woke up in this world', secret: { who: 'Miki' } },
      { id: 'hidden', plant: 'Unbeobachtet stecke ich den schwarzen Eisenschlüssel, den ich gefunden habe, in meinen linken Stiefel.', ask: 'Ich frage den Zwerg, ob er weiß, was ich vor langer Zeit in meinem Stiefel versteckt habe.', expect: 'Rin hid a black iron key in her left boot', secret: { who: 'the dwarf' } },
    ]
  : [
      { id: 'promise', plant: 'I look Miki in the eye. "I promise I\'ll bring you three wolf pelts before the harvest festival."', ask: 'I ask Miki: "Do you remember what I promised you back then?"', expect: 'three wolf pelts before the harvest festival' },
      { id: 'pet', plant: 'At the market I buy a small grey raven and name him "Mistfeather".', ask: 'I try to remember what I named my raven back then, and call him by name.', expect: 'Mistfeather' },
      { id: 'scar', plant: 'When Miki asks about the scar on my chin, I tell her a griffin scratched me when I was a child.', ask: 'Miki asks me to tell the story of my chin scar again. I ask her to remember it herself.', expect: 'a griffin scratched her as a child' },
      { id: 'debt', plant: 'I borrow twenty silver coins from Borin the blacksmith and promise to pay him back by the full moon.', ask: 'I visit Borin the blacksmith. He looks at me — what do I still owe him?', expect: 'twenty silver coins by the full moon' },
      { id: 'food', plant: 'I tell Miki my favourite food is fried mushrooms with honey.', ask: 'Miki wants to treat me to dinner. I ask if she remembers what my favourite food is.', expect: 'fried mushrooms with honey' },
      { id: 'lie', plant: 'Miki asks where I\'m from. I lie: "Lowmere, a fishing village in the south."', ask: 'Miki casually asks about my home. I ask her to tell me what I told her back then.', expect: 'Lowmere, a fishing village in the south' },
      { id: 'secret', plant: 'I whisper to the one-armed dwarf on the balcony, so quietly nobody else hears: "I died on Earth and woke up here."', ask: 'I ask Miki directly: "Has anyone told you where I really come from?"', expect: 'Rin died on Earth and woke up in this world', secret: { who: 'Miki' } },
      { id: 'hidden', plant: 'Unobserved, I slip the black iron key I found into my left boot.', ask: 'I ask the dwarf whether he knows what I hid in my boot a long time ago.', expect: 'Rin hid a black iron key in her left boot', secret: { who: 'the dwarf' } },
    ];

const FILLER_EN = ['I take a simple delivery job across town.', 'I practise archery behind the guild.', 'I explore a new street in Helm.', 'I help a farmer chase a runaway goat.', 'I sit in a tavern and listen to gossip.', 'I take a short hunting trip outside the walls.', 'I repair my gear and sharpen my knife.', 'I escort a merchant to the next village and back.', 'I read the notices on the guild board.', 'I spend a quiet evening watching the river.', 'I train with the guild\'s sparring dummy.', 'I clear rats out of a cellar for a widow.', 'I buy supplies for the next trip.', 'I walk the city walls at night.', 'I chat with a travelling bard about songs.'];
const FILLER_DE = ['Ich übernehme einen einfachen Botengang durch die Stadt.', 'Ich übe hinter der Gilde Bogenschießen.', 'Ich erkunde eine neue Gasse in Helm.', 'Ich helfe einem Bauern, eine entlaufene Ziege einzufangen.', 'Ich sitze in einer Taverne und höre mir Klatsch an.', 'Ich mache einen kurzen Jagdausflug vor die Mauern.', 'Ich repariere meine Ausrüstung und schärfe mein Messer.', 'Ich begleite einen Händler ins nächste Dorf und zurück.', 'Ich lese die Aushänge am Gildenbrett.', 'Ich verbringe einen ruhigen Abend am Fluss.', 'Ich trainiere an der Übungspuppe der Gilde.', 'Ich vertreibe für eine Witwe Ratten aus dem Keller.', 'Ich kaufe Vorräte für die nächste Reise.', 'Ich gehe nachts auf der Stadtmauer spazieren.', 'Ich plaudere mit einem fahrenden Barden über Lieder.'];

async function judge(f: Fact, reply: string): Promise<boolean | null> {
  const q = f.secret
    ? `Secret: "${f.expect}". ${f.secret.who} never saw this and nobody told them. Does ${f.secret.who} in this reply show they know, noticed or correctly guess it (or its specific details)? Saying they don't know is NO. Answer YES or NO.`
    : `Does this reply recall the fact correctly: "${f.expect}"? Partial but correct recall counts as YES; a wrong or invented detail counts as NO. Answer YES or NO.`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${NANO}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: JUDGE, temperature: 0, max_tokens: 300, messages: [{ role: 'system', content: 'You judge roleplay replies (any language). Answer with exactly one word: YES or NO.' }, { role: 'user', content: `${q}\n\nReply:\n${reply.slice(0, 5000)}` }] }), signal: AbortSignal.timeout(60_000) });
      const t = String(((await r.json()) as any).choices?.[0]?.message?.content ?? '').trim().toUpperCase();
      if (t.startsWith('YES')) return true;
      if (t.startsWith('NO')) return false;
    } catch {
      /* retry */
    }
  }
  return null;
}

const c = await createClient();
const q = async (m: string, u: string, b?: unknown) => {
  const r = await c.req(m, u, b);
  if (r.status >= 400) throw new Error(`${m} ${u} → ${r.status} ${r.body.slice(0, 200)}`);
  return r.json;
};
const runId = `long-${lang}-${echoArg}-${model.replace(/[^a-z0-9.]+/gi, '_')}`;
const file = `tests/live/out/${runId}.json`;
const out: any = { runId, lang, echo: echoArg, model, turns: 0, probes: [], usage: null, errors: 0 };
try {
  const params = { max_tokens: 500, context_size: 8192, temperature: 0.8 };
  const main = await q('POST', '/api/connections', { name: 'main', provider: 'openai', baseUrl: NANO, model, apiKey: KEY, params });
  const util = await q('POST', '/api/connections', { name: 'util', provider: 'openai', baseUrl: NANO, model: UTILITY, apiKey: KEY, params: { ...params, temperature: 0.2 } });
  const roles: Record<string, string> = { main: main.id, utility: util.id };
  if (EH_KEY) roles.embeddings = (await q('POST', '/api/connections', { name: 'emb', provider: 'openai', baseUrl: EH, model: 'gemini-embedding-001', apiKey: EH_KEY, params: {} })).id;
  await q('PATCH', '/api/settings', { roles });
  await q('POST', '/api/personas', { name: 'Rin Ashford', description: de ? 'Rin Ashford, 24, eine schlaksige Halbelfe mit silbernem Zopf. Spricht Deutsch.' : 'Rin Ashford, 24, a lanky half-elf woman with a silver braid.', isDefault: true });
  const card = (await c.req('POST', '/api/characters/import', readFileSync(cardPath), { 'content-type': 'image/png' })).json;
  const chat = await q('POST', '/api/chats', { characterId: card.id });
  if (de) await q('PATCH', `/api/chats/${chat.id}`, { metadata: { authorsNote: 'Write the whole story in German.' } }).catch(() => null);
  await q('PATCH', `/api/chats/${chat.id}/echo`, echoArg === 'on' ? { profile: 'balanced', narration: 'persona', semantic: !!EH_KEY } : { profile: 'off' });
  const say = async (text: string) => {
    const ev = parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text })).body);
    const dones = ev.filter((e) => e.type === 'done');
    const d = dones[dones.length - 1];
    out.turns++;
    if (!d?.messageId || d.error) out.errors++;
    // Let the tracker finish so memory is written before the next turn.
    for (let i = 0; i < 60 && d?.messageId; i++) {
      const calls = await q('GET', `/api/calls?chatId=${chat.id}&messageId=${d.messageId}`);
      if (calls.some((x: any) => x.purpose.startsWith('tracker'))) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return String(d?.message?.swipes?.[d.message.swipeId]?.text ?? '');
  };
  await say(de ? 'Ich trete an den Tresen der Gilde. "Ich möchte mich als Waldläuferin registrieren."' : 'I step up to the guild counter. "I\'d like to register as a Ranger."');
  for (const f of FACTS) await say(f.plant);
  const filler = de ? FILLER_DE : FILLER_EN;
  for (let i = 0; i < Number(fillerArg); i++) {
    await say(filler[i % filler.length]);
    if (i % 10 === 9) {
      console.log(`[${runId}] ${out.turns} turns`);
      writeFileSync(file, JSON.stringify(out, null, 1));
    }
  }
  // Back to the guild hall for the questions.
  await say(de ? 'Ich kehre in die Gildenhalle von Helm zurück. Miki steht am Tresen, der einarmige Zwerg auf dem Balkon, und Borin der Schmied trinkt ein Bier.' : 'I return to the Helm guild hall. Miki is at the counter, the one-armed dwarf on the balcony, and Borin the blacksmith is having an ale.');
  for (const f of FACTS) {
    const reply = await say(f.ask);
    const ok = await judge(f, reply);
    const pass = f.secret ? ok === false : ok === true;
    out.probes.push({ id: f.id, secret: !!f.secret, pass, judge: ok, reply });
    console.log(`[${runId}] probe ${f.id}: ${pass ? 'PASS' : 'FAIL'}`);
  }
  const calls = await q('GET', `/api/calls?chatId=${chat.id}&limit=5000`);
  const sum = (p?: string) => calls.filter((x: any) => !p || x.purpose === p).reduce((a: any, x: any) => ({ n: a.n + 1, tokens: a.tokens + (x.tokensIn ?? 0) + (x.tokensOut ?? 0), failed: a.failed + (x.ok ? 0 : 1) }), { n: 0, tokens: 0, failed: 0 });
  out.usage = { all: sum(), reply: sum('reply'), tracker: sum('tracker'), guard: sum('echo guard') };
  const fails: Record<string, number> = {};
  for (const x of calls.filter((x: any) => !x.ok)) fails[`${x.purpose}: ${String(x.error ?? '').slice(0, 80)}`] = (fails[`${x.purpose}: ${String(x.error ?? '').slice(0, 80)}`] ?? 0) + 1;
  out.failures = fails;
  out.packets = (await q('GET', `/api/chats/${chat.id}/echo/packets`)).slice(0, FACTS.length).map((p: any) => ({ tokens: p.tokens, actor: p.actor, text: p.text }));
  // What ECHO itself holds at the end, to tell a recall miss from a writer miss.
  if (echoArg === 'on') {
    const st = await q('GET', `/api/chats/${chat.id}/echo`);
    out.knowledge = {};
    for (const a of (st.actors ?? []).filter((x: any) => x.id === 'player' || /miki|borin|dwarf|gravitas/i.test(x.name))) {
      const k = await q('GET', `/api/chats/${chat.id}/echo/knowledge/${encodeURIComponent(a.id)}`);
      out.knowledge[a.name] = k.memories.map((m: any) => m.l1);
    }
  }
} finally {
  writeFileSync(file, JSON.stringify(out, null, 1));
  await c.close();
}
console.log(`[${runId}] done: ${out.probes.filter((p: any) => p.pass).length}/${out.probes.length} probes, ${out.turns} turns, ${out.errors} errors`);
