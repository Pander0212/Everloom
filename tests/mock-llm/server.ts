/**
 * Mock OpenAI-compatible LLM server for tests. No API key needed.
 *   GET  /v1/models
 *   POST /v1/chat/completions   (streams canned story text; answers tracker/summary/helper prompts with JSON)
 *   POST /v1/embeddings         (deterministic hash vectors)
 *   POST /v1/images/generations (tiny PNG)
 *   POST /v1/audio/speech       (tiny WAV)
 *   POST /__control             (set behaviour: trackerMode, story, delayMs, failNext, trackerOps)
 */
import http from 'node:http';

export interface MockControl {
  trackerMode: 'valid' | 'messy' | 'broken-once' | 'garbage' | 'empty';
  trackerOps: unknown[] | null;
  trackerMemories: unknown[] | null;
  trackerFacts: unknown[] | null;
  story: string | null;
  delayMs: number;
  failNext: number;
  hangNext: number;
  calls: Array<{ path: string; model: string; kind: string; body: any }>;
}

const control: MockControl = { trackerMode: 'valid', trackerOps: null, trackerMemories: null, trackerFacts: null, story: null, delayMs: 5, failNext: 0, hangNext: 0, calls: [] };
let takes = 0;
let brokenServed = false;

const STORIES = [
  'Iris leans on the counter and slides a sweating glass across to you. "Iced lemon tea, on the house," she says, her smile small but real. Outside, the market hums as the afternoon light slants through the dusty window. *She glances toward the door, as if expecting someone.* "Tobias said he would be here by now."',
  'The bell above the door jingles. Tobias Moreno steps in, shaking rain from his coat. "Sorry, the rehearsal ran long," he says, dropping onto the stool beside you. *He eyes your drink with open envy.* "You know, the Ravens are still looking for a singer."',
  'Iris laughs quietly and wipes down the bar. "Don\'t let him rope you into anything," she warns, though her eyes are warm. *A comfortable silence settles as rain taps against the glass.*',
];

function storyFor(messages: any[]): string {
  if (control.story) return control.story;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const base = STORIES[takes % STORIES.length];
  takes++;
  return /\bcontinue\b/i.test(String(lastUser)) ? ` ${base.split('.')[0]}.` : `${base} (take ${takes})`;
}

function trackerAnswer(prompt: string): string {
  const story = prompt.split('Recent story')[1] ?? prompt;
  const ops: any[] = control.trackerOps ? [...control.trackerOps] : [];
  if (!control.trackerOps) {
    ops.push({ type: 'time.advance', minutes: 20 });
    if (/lemon tea/i.test(story)) ops.push({ type: 'item.add', name: 'Iced Lemon Tea', qty: 1, category: 'drink' });
    if (/Tobias/.test(story)) ops.push({ type: 'npc.upsert', name: /Tobias Moreno/.test(story) ? 'Tobias Moreno' : 'Tobias', role: 'Band leader', org: 'The Ravens' });
    if (/Iris/.test(story)) ops.push({ type: 'relationship.delta', name: 'Iris', affection: 2, trust: 1 });
    if (/wolf/i.test(story)) ops.push({ type: 'battle.start', enemies: [{ name: 'Wolf', level: 1 }] });
  }
  const memories: any[] = control.trackerMemories ? [...control.trackerMemories] : [];
  const facts: any[] = control.trackerFacts ? [...control.trackerFacts] : [];
  if (!control.trackerMemories && /Tobias/.test(story)) memories.push({ text: 'Tobias said the Ravens need a singer by Friday.', about: ['Tobias'], importance: 2 });
  const json = JSON.stringify({ ops, memories, facts });
  switch (control.trackerMode) {
    case 'messy':
      return 'Sure! Here are the changes:\n```json\n' + json.replace(/"type"/g, "'type'").replace(/\]\}$/, ',]}') + '\n```\nLet me know if you need more.';
    case 'broken-once':
      if (!brokenServed) {
        brokenServed = true;
        return 'The scene shows tea and a friendly chat, nothing else.';
      }
      return json;
    case 'garbage':
      return 'I cannot produce JSON for this.';
    case 'empty':
      return '{"ops":[]}';
    default:
      return json;
  }
}

function classify(messages: any[]): string {
  const sys = String(messages.find((m) => m.role === 'system')?.content ?? '');
  const all = messages.map((m) => String(m.content)).join('\n');
  if (/bookkeeper for a roleplay game/i.test(sys)) return 'tracker';
  if (/summarize stories/i.test(sys)) return 'summary';
  if (/connection test/i.test(sys)) return 'test';
  if (/helper companion/i.test(sys)) return 'helper';
  if (/map designer/i.test(sys)) return 'map';
  if (/diary entry/i.test(sys)) return 'diary';
  if (/text message/i.test(sys) || /phone/i.test(sys)) return 'phone';
  if (/game designer/i.test(all)) return 'wizard';
  return 'story';
}

function answerFor(kind: string, messages: any[]): string {
  const all = messages.map((m) => String(m.content)).join('\n');
  switch (kind) {
    case 'tracker':
      if (/previous output was not valid JSON/i.test(all)) return JSON.stringify({ ops: [{ type: 'time.advance', minutes: 20 }, { type: 'item.add', name: 'Iced Lemon Tea', qty: 1 }] });
      return trackerAnswer(all);
    case 'summary':
      return JSON.stringify({ summary: 'Anala met Iris at the bar; Tobias arrived late and mentioned the Ravens need a singer.', facts: ['Tobias leads a band called the Ravens.'] });
    case 'test':
      return 'ready';
    case 'helper':
      return JSON.stringify({ reply: 'Here is a potion idea for you.', ops: [{ type: 'item.add', name: 'Minor Healing Potion', qty: 1, category: 'consumable' }] });
    case 'map':
      return JSON.stringify({ nodes: [{ name: 'Lantern Row', kind: 'district', description: 'A lane of paper lanterns.' }, { name: 'Old Pier', kind: 'dock', description: 'Creaking boards over dark water.' }] });
    case 'diary':
      return JSON.stringify({ title: 'Rain and lanterns', text: 'Today Iris poured me tea and Tobias talked about the Ravens. I think I might sing.', mood: 'hopeful' });
    case 'phone':
      return 'hey, you still up? rehearsal was a mess lol';
    case 'wizard':
      return JSON.stringify({ opening: 'The rain has not stopped for three days when you arrive in Northcrest.', items: [{ name: 'Umbrella', category: 'tool' }], npcs: [{ name: 'Iris Thorne', role: 'Bartender' }], location: { world: 'Aurel', region: 'Greenmarch', local: 'Northcrest', description: 'A rain-soaked market town on the river.', kind: 'town' }, quests: [{ title: 'Dry Ground', desc: 'Find shelter before nightfall.', objectives: ['Find an inn'] }], facts: ['It has rained for three days.'] });
    default:
      return storyFor(messages);
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function wav(): Buffer {
  const samples = 800;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

export function createMockLlm() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname.replace(/^\/v1/, '');
    if (req.method === 'GET' && p === '/models') return sendJson(res, 200, { data: [{ id: 'mock-story' }, { id: 'mock-utility' }] });
    if (req.method === 'GET' && p === '/__control') return sendJson(res, 200, control);
    const body = await readBody(req);
    if (p === '/__control') {
      Object.assign(control, body);
      if (body.reset) {
        Object.assign(control, { trackerMode: 'valid', trackerOps: null, trackerMemories: null, trackerFacts: null, story: null, delayMs: 5, failNext: 0, hangNext: 0, calls: [] });
        takes = 0;
        brokenServed = false;
      }
      return sendJson(res, 200, { ok: true });
    }
    if (control.hangNext > 0) {
      control.hangNext--;
      return; // never respond
    }
    if (control.failNext > 0) {
      control.failNext--;
      return sendJson(res, 500, { error: { message: 'Mock upstream failure' } });
    }
    if (p === '/embeddings') {
      const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
      const vec = (t: string) => {
        const v = new Array(32).fill(0);
        for (const w of String(t).toLowerCase().split(/\W+/)) if (w) v[[...w].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 32] += 1;
        return v;
      };
      return sendJson(res, 200, { data: inputs.map((t, i) => ({ index: i, embedding: vec(t) })) });
    }
    if (p === '/images/generations') return sendJson(res, 200, { data: [{ b64_json: PNG_1x1.toString('base64') }] });
    if (p === '/audio/speech') {
      res.writeHead(200, { 'content-type': 'audio/wav' });
      return res.end(wav());
    }
    if (p === '/chat/completions') {
      const messages: any[] = body.messages ?? [];
      const kind = classify(messages);
      control.calls.push({ path: p, model: body.model, kind, body });
      if (control.calls.length > 200) control.calls.shift();
      const text = answerFor(kind, messages);
      if (!body.stream) return sendJson(res, 200, { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const words = text.match(/\S+\s*/g) ?? [text];
      let aborted = false;
      req.on('close', () => (aborted = true));
      res.on('close', () => (aborted = true));
      for (const w of words) {
        if (aborted) return;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`);
        if (control.delayMs) await new Promise((r) => setTimeout(r, control.delayMs));
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    sendJson(res, 404, { error: { message: `mock: no route ${p}` } });
  });
}

export function startMockLlm(port = 0): Promise<{ url: string; close: () => Promise<void>; control: MockControl }> {
  const server = createMockLlm();
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1`,
        control,
        close: () => new Promise((r) => {
          server.closeAllConnections?.();
          server.close(() => r());
        }),
      });
    });
  });
}

// Run directly: `npx tsx tests/mock-llm/server.ts [port]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? process.env.MOCK_LLM_PORT ?? 5055);
  startMockLlm(port).then(({ url }) => console.log(`Mock LLM listening at ${url}`));
}
