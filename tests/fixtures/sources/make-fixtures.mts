/**
 * Builds the synthetic fixtures for Character Tavern, Botbooru, Saucepan and AI Character Cards.
 * The shapes follow responses recorded from each site on 2026-10-05; every name, text and id here is
 * made up (the recorded characters belong to their creators).
 *
 *   npx tsx tests/fixtures/sources/make-fixtures.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { buildV3Json, emptyCardData, writeCardToPng } from '../../../packages/engine/src/index.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const out = (site: string, file: string, body: string | Uint8Array) => {
  mkdirSync(path.join(ROOT, site), { recursive: true });
  writeFileSync(path.join(ROOT, site, file), body);
};
const json = (v: unknown) => JSON.stringify(v, null, 1);
const routes = (site: string, list: Array<{ method?: string; url: string; body?: string; file: string; status?: number }>) => out(site, 'routes.json', json({ routes: list }));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------------ SvelteKit (devalue) encoding

/** Flattens a value the way SvelteKit's devalue does; `promise(n)` marks a streamed value. */
class Deferred {
  constructor(
    readonly id: number,
    readonly value: unknown,
  ) {}
}
function devalue(root: unknown): unknown[] {
  const out: unknown[] = [];
  const seen = new Map<unknown, number>();
  const walk = (v: unknown): number => {
    if (v !== null && typeof v === 'object' && seen.has(v)) return seen.get(v)!;
    const i = out.length;
    out.push(null);
    if (v !== null && typeof v === 'object') seen.set(v, i);
    if (v instanceof Deferred) out[i] = ['Promise', v.id];
    else if (v instanceof Date) out[i] = ['Date', v.toISOString()];
    else if (Array.isArray(v)) out[i] = v.map(walk);
    else if (v && typeof v === 'object') out[i] = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    else out[i] = v;
    return i;
  };
  walk(root);
  return out;
}
function svelteKit(data: unknown, nodeIndex = 2): string {
  const deferred: Deferred[] = [];
  const collect = (v: unknown) => {
    if (v instanceof Deferred) deferred.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(data);
  const nodes: unknown[] = Array.from({ length: nodeIndex }, () => ({ type: 'skip' }));
  nodes.push({ type: 'data', data: devalue(data), uses: { search_params: ['query'] } });
  const lines = [JSON.stringify({ type: 'data', nodes })];
  for (const d of deferred) lines.push(JSON.stringify({ type: 'chunk', id: d.id, data: devalue(d.value) }));
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------------ Character Tavern

const ctHits = [
  { id: 'CT_0000000000000000000000000000wren', name: 'Wren of the Lantern Archive', tagline: 'A night librarian who catalogues dreams', path: 'quillwright/wren_of_the_lantern_archive', author: 'quillwright', contentWarnings: [], permanentTokens: 640 },
  { id: 'CT_0000000000000000000000000000orla', name: 'Captain Orla Vey', tagline: 'Smuggler captain of the salt marsh', path: 'saltmarsh/captain_orla_vey', author: 'saltmarsh', contentWarnings: [], permanentTokens: 410 },
  { id: 'CT_000000000000000000000000000velv', name: 'Velvet Lounge Host', tagline: 'Adults only', path: 'nightowl/velvet_lounge_host', author: 'nightowl', contentWarnings: ['sexual content'], permanentTokens: 900 },
];
out('ctavern', 'search.ndjson', svelteKit({ searchResults: { hits: ctHits, totalHits: 3, hitsPerPage: 30, page: 1, totalPages: 1, processingTimeMs: 2, query: '', hiddenByPrefs: false }, query: '', sort: 'best', tags: '', exclude_tags: '', page: 1, hasLorebook: false, isOC: false }));
out('ctavern', 'tags.ndjson', svelteKit({ user: null, catalogue: new Deferred(1, { tags: [{ value: 'fantasy', count: 812 }, { value: 'librarian', count: 12 }, { value: 'pirate', count: 95 }, { value: 'female', count: 2400 }] }) }, 0));
const ctChar = (h: (typeof ctHits)[number], extra: Record<string, unknown>) => ({
  character: {
    id: h.id,
    origin: 'Character Tavern',
    name: h.name,
    inChatName: h.name.split(' ')[0],
    author: 101,
    path: h.path,
    tagline: h.tagline,
    description: `About ${h.name}: an original character made for these tests.`,
    isNSFW: h.contentWarnings.length > 0,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    lastUpdatedAt: new Date('2026-09-20T10:00:00Z'),
    visibility: 'public',
    lorebookId: null,
    definition_scenario: 'The archive after closing time.',
    definition_personality: 'Patient, curious, quietly funny.',
    definition_character_description: `{{char}} is ${h.name}, who ${h.tagline.toLowerCase()}.`,
    definition_first_message: '*A lantern flickers on.* "You found the late shelves."',
    definition_example_messages: '',
    definition_system_prompt: null,
    definition_post_history_prompt: '',
    tokenTotal: h.permanentTokens,
    versionId: 7,
    ...extra,
  },
  authorUserId: 101,
  tags: ['fantasy', 'librarian'],
  contentWarnings: h.contentWarnings,
  alternativeGreetings: new Deferred(1, ['"Mind the ink," Wren says.', '"Another sleepless reader?"']),
  authorUsername: h.author,
  lorebook: new Deferred(2, { name: 'Lantern Archive', entries: [{ keys: ['lantern'], content: 'Lanterns in the archive burn without oil.', enabled: true, insertion_order: 100 }] }),
});
out('ctavern', 'wren.ndjson', svelteKit(ctChar(ctHits[0]!, {})));
out('ctavern', 'orla.ndjson', svelteKit({ ...ctChar(ctHits[1]!, { inChatName: 'Orla', visibility: 'unlisted_hidden' }), alternativeGreetings: new Deferred(1, null), lorebook: new Deferred(2, null) }));
out('ctavern', 'velvet.ndjson', svelteKit(ctChar(ctHits[2]!, { inChatName: 'Velvet' })));
routes('ctavern', [
  { url: '^https://character-tavern\\.com/search/cards/__data\\.json\\?.*x-sveltekit-invalidated=001', file: 'search.ndjson' },
  { url: '^https://character-tavern\\.com/search/cards/__data\\.json\\?x-sveltekit-invalidated=01$', file: 'tags.ndjson' },
  { url: '^https://character-tavern\\.com/character/quillwright/wren_of_the_lantern_archive/__data\\.json', file: 'wren.ndjson' },
  { url: '^https://character-tavern\\.com/character/saltmarsh/captain_orla_vey/__data\\.json', file: 'orla.ndjson' },
  { url: '^https://character-tavern\\.com/character/nightowl/velvet_lounge_host/__data\\.json', file: 'velvet.ndjson' },
]);

// ------------------------------------------------------------------ Botbooru

const bbTag = (id: number, name: string, category: string) => ({ id, name, category, system_managed: category === 'Auto' });
const bbPosts = [
  { id: 90001, name: 'Mossheart the Gardener', writer: 'fernwright', tags: [bbTag(25, 'sfw', 'Auto'), bbTag(845, 'contains_lorebook', 'Auto'), bbTag(42, 'multiple_greetings', 'Auto'), bbTag(2539, 'english', 'Language'), bbTag(7, 'fantasy', 'General'), bbTag(8, 'gardener', 'General'), bbTag(4507, 'fernwright', 'Writer')], tokens: 1200 },
  { id: 90002, name: 'Tin Lark', writer: 'cogsmith', tags: [bbTag(25, 'sfw', 'Auto'), bbTag(2539, 'english', 'Language'), bbTag(9, 'robot', 'General'), bbTag(4508, 'cogsmith', 'Writer')], tokens: 700 },
  { id: 90003, name: 'Midnight Masquerade', writer: 'nightowl', tags: [bbTag(26, 'nsfw', 'Auto'), bbTag(2539, 'english', 'Language'), bbTag(7, 'fantasy', 'General'), bbTag(4509, 'nightowl', 'Writer')], tokens: 2000 },
];
const bbListItem = (p: (typeof bbPosts)[number]) => ({
  id: p.id,
  download_state: null,
  filename: `${p.id.toString(16).padStart(32, 'a')}.png`,
  card_image_revision: 1,
  character_name: p.name,
  created_at: '2026-09-10T08:00:00.000000',
  content_updated_at: '2026-09-12T08:00:00.000000',
  uploader_id: 1,
  tags: p.tags,
  card_is_animated: false,
  is_fork: false,
  views: 40,
  downloads: 12,
  favorite_count: 3,
  comments_count: 0,
  token_count: p.tokens,
  creator_notes_excerpt: `Notes for ${p.name}.`,
  description_excerpt: `{{char}} is ${p.name}.`,
});
out('botbooru', 'posts.json', json({ total: bbPosts.length, posts: bbPosts.map(bbListItem) }));
for (const p of bbPosts) {
  const { token_count: _t, creator_notes_excerpt: _n, description_excerpt: _d, ...base } = bbListItem(p);
  out(
    'botbooru',
    `post-${p.id}.json`,
    json({
      ...base,
      status: 'active',
      slug: 'x1y2z',
      description: `{{char}} is ${p.name}, written for Everloom's tests.`,
      personality: 'Gentle and stubborn.',
      scenario: 'A greenhouse at dawn.',
      first_mes: `*${p.name} looks up.* "Oh, a visitor."`,
      mes_example: '',
      creator_notes: 'Use &lt;b&gt;gently&lt;/b&gt;.',
      creator_notes_display: 'Use **gently**.',
      uploader_notes: '',
      tagline: `${p.name} in one line.`,
      system_prompt: '',
      post_history_instructions: '',
      depth_prompt: { depth: 4, role: 'system' },
      alternate_greetings: JSON.stringify(p.id === 90001 ? ['"The roses are early this year."'] : []),
      uploader_name: p.writer,
      has_lorebook: p.id === 90001,
      lorebook_json: p.id === 90001 ? JSON.stringify({ entries: { 0: { uid: 0, key: ['greenhouse'], keysecondary: [], content: 'The greenhouse is older than the town.', comment: 'Greenhouse', disable: false, order: 100 } } }, null, 2) : '',
      revision_count: 2,
      origin: 'Original',
    }),
  );
}
out('botbooru', 'tags.json', json([{ id: 7, name: 'fantasy', category: 'General', count: 5400, alias_of: null }, { id: 8, name: 'gardener', category: 'General', count: 40, alias_of: null }, { id: 25, name: 'sfw', category: 'Auto', count: 90000, alias_of: null }, { id: 4507, name: 'fernwright', category: 'Writer', count: 3, alias_of: null }, { id: 77, name: 'gardening', category: 'General', count: 1, alias_of: 8 }]));
out('botbooru', 'token.json', json({ access_token: 'fixture-session-token', token_type: 'bearer' }));
routes('botbooru', [
  { url: '^https://botbooru\\.com/posts/\\?', file: 'posts.json' },
  { url: '^https://botbooru\\.com/tags/$', file: 'tags.json' },
  ...bbPosts.map((p) => ({ url: `^https://botbooru\\.com/post/${p.id}$`, file: `post-${p.id}.json` })),
  { method: 'POST', url: '^https://botbooru\\.com/auth/token$', body: 'password=right', file: 'token.json' },
  { method: 'POST', url: '^https://botbooru\\.com/auth/token$', file: 'token.json', status: 401 },
]);

// ------------------------------------------------------------------ Saucepan

const spCompanions = [
  { id: '5a5a5a5a-0000-4000-8000-000000000001', name: 'Pip the Cartographer', tags: ['fantasy', 'map_maker', 'female'], sus: false, scen: 2 },
  { id: '5a5a5a5a-0000-4000-8000-000000000002', name: 'Quiet Warden', tags: ['fantasy', 'guard'], sus: false, scen: 1 },
  { id: '5a5a5a5a-0000-4000-8000-000000000003', name: 'Afterhours Club', tags: ['nightlife'], sus: true, scen: 1 },
];
out(
  'saucepan',
  'search.json',
  json({
    companions: spCompanions.map((c) => ({
      id: c.id,
      author_id: '9b9b9b9b-0000-4000-8000-000000000001',
      author_handle: 'inkpot',
      name: c.name,
      display_name: c.name,
      short_description: `${c.name}, made up for tests.`,
      tags: c.tags,
      image: { id: `img-${c.id.slice(-4)}` },
      sus: c.sus,
      very_sus: false,
      access_level: 'public',
      locked_starting_message: false,
      interaction_count: 30,
      chat_count: 4,
      portrait_count: 1,
      favorite_count: 5,
      scenario_count: c.scen,
      group_count: 0,
      lorebook_count: 0,
      posted_at: '2026-09-01 10:00:00.0 +00:00:00',
      updated_at: '2026-09-02 10:00:00.0 +00:00:00',
      card_token_count: 900,
      fandom_tags: [],
    })),
    total_count: spCompanions.length,
    hidden_count: 0,
  }),
);
out('saucepan', 'definition-1.json', json({ card: '{{char}} draws maps of places that do not exist yet.', full_description: 'Pip maps the unmapped.', example_dialogue: '{{char}}: "Hold this corner."', formatting_instructions: null, advanced_prompt: null, starting_scenarios: [{ name: 'Market', message: '"Need a map?"' }, { name: 'Storm', message: '"The coast moved again."' }], hidden_fields: 0, open_definition: true }));
out('saucepan', 'definition-2.json', json({ card: null, full_description: 'The warden keeps her secrets.', example_dialogue: null, starting_scenarios: [{ name: 'Gate', message: '"Halt."' }], hidden_fields: 7, open_definition: false }));
out('saucepan', 'signin.json', json({ token: 'fixture-saucepan-token', user: { handle: 'tester' } }));
out('saucepan', 'error-401.json', json({ error: { code: 'auth.missing_authorization', message: 'You are not logged in. Please log in to continue.', retryable: false } }));
routes('saucepan', [
  { method: 'POST', url: '^https://saucepan\\.ai/api/v1/search$', file: 'search.json' },
  { url: `^https://saucepan\\.ai/api/v1/companion/definition\\?companion_id=${esc(spCompanions[0]!.id)}$`, file: 'definition-1.json' },
  { url: `^https://saucepan\\.ai/api/v1/companion/definition\\?companion_id=${esc(spCompanions[1]!.id)}$`, file: 'definition-2.json' },
  { method: 'POST', url: '^https://saucepan\\.ai/api/v1/auth/sign_in_password$', body: '"password":"right"', file: 'signin.json' },
  { method: 'POST', url: '^https://saucepan\\.ai/api/v1/auth/sign_in_password$', file: 'error-401.json', status: 401 },
]);

// ------------------------------------------------------------------ AI Character Cards

const aiccCards = [
  { id: 4001, title: 'Juno the Ferrywoman', tags: [{ id: 363, name: 'Slice of Life' }, { id: 361, name: 'Adventure/RPG' }], nsfw: false, lang: 'en' },
  { id: 4002, title: 'Brass Owl', tags: [{ id: 361, name: 'Adventure/RPG' }], nsfw: false, lang: 'de' },
  { id: 4003, title: 'Red Room', tags: [{ id: 370, name: 'Romance' }], nsfw: true, lang: 'en' },
];
const aiccItem = (c: (typeof aiccCards)[number]) => ({
  id: c.id,
  userId: 500,
  title: c.title,
  description: `${c.title}: a made-up card for tests.`,
  excerpt: `${c.title}, short version.`,
  titleEn: c.title,
  excerptEn: `${c.title}, short version.`,
  imageUrl: `/uploads/character_cards/500/card-500-${c.id}-opt.webp`,
  language: c.lang,
  isNsfw: c.nsfw,
  isAnimated: false,
  status: 'published',
  downloadCount: 9,
  ratingAvg: null,
  ratingCount: 0,
  tokenCount: 800,
  createdAt: '2026-09-15T00:00:00.000Z',
  tags: c.tags,
  author: 'ferryman',
});
out('aicc', 'cards.json', json({ data: aiccCards.map(aiccItem), pagination: { skip: 0, limit: 24, total: aiccCards.length } }));
out('aicc', 'card-4001.json', json({ message: 'ok', data: { ...aiccItem(aiccCards[0]!), descriptionFormat: 'basic', updatedAt: '2026-09-16T00:00:00.000Z', attachedLorebookId: null, attachedLorebook: null, versions: [{ id: 1, version: 1, isCurrent: false, fileUrl: '/uploads/character_cards/500/old.png' }, { id: 2, version: 2, isCurrent: true, fileUrl: '/uploads/character_cards/500/card-500-4001.png' }], cardFormat: 'st' } }));
out('aicc', 'tags.json', json({ message: 'Tags retrieved successfully', data: [{ id: 361, name: 'Adventure/RPG', slug: 'adventure-rpg', rating: 'both' }, { id: 363, name: 'Slice of Life', slug: 'slice-of-life', rating: 'both' }, { id: 370, name: 'Romance', slug: 'romance', rating: 'both' }] }));
const png = readFileSync(path.join(ROOT, '..', 'st', 'Seraphina.png'));
const card = { ...emptyCardData('Juno the Ferrywoman'), description: '{{char}} rows travellers across a misty river.', first_mes: '"Two coins, and mind the oar."', alternate_greetings: ['"Fog again."'], creator: 'ferryman', tags: ['Slice of Life'] };
out('aicc', 'card-4001.png', writeCardToPng(new Uint8Array(png), card));
routes('aicc', [
  { url: '^https://api\\.aicharactercards\\.com/api/cards\\?', file: 'cards.json' },
  { url: '^https://api\\.aicharactercards\\.com/api/cards/metadata/tags$', file: 'tags.json' },
  { url: '^https://api\\.aicharactercards\\.com/api/cards/4001$', file: 'card-4001.json' },
  { url: '^https://api\\.aicharactercards\\.com/uploads/character_cards/500/card-500-4001\\.png$', file: 'card-4001.png' },
]);

// ------------------------------------------------------------------ RisuRealm: a card stored as CHARX

// Its JSON download answers 400; the CHARX one is a picture with the zip after it (offsets in the
// zip don't count the picture), as some RisuAI exports are.
const risuMeta = readFileSync(path.join(ROOT, 'risu', 'meta-1f2e3d4c-0000-4000-8000-00000000a001.json'), 'utf8').replaceAll('1f2e3d4c-0000-4000-8000-00000000a001', '1f2e3d4c-0000-4000-8000-00000000a003');
out('risu', 'meta-1f2e3d4c-0000-4000-8000-00000000a003.json', risuMeta);
const charxCard = buildV3Json({ ...emptyCardData('Sable of the Charx Shelf'), description: '{{char}} only travels zipped.', first_mes: '"Unpack me gently."' });
(charxCard.data as any).assets = [{ type: 'icon', uri: 'embeded://assets/icon/image/main.png', name: 'main', ext: 'png' }];
const zip = zipSync({ 'card.json': strToU8(JSON.stringify(charxCard)), 'assets/icon/image/main.png': new Uint8Array(png), 'module.risum': new Uint8Array([1, 2, 3]) });
out('risu', 'card-1f2e3d4c-0000-4000-8000-00000000a003.charx', Buffer.concat([png, Buffer.from(zip)]));
out('risu', 'error-400.json', json({ error: 'This card is stored as CHARX' }));
const risuRoutes = JSON.parse(readFileSync(path.join(ROOT, 'risu', 'routes.json'), 'utf8')).routes.filter((r: { file: string }) => !r.file.includes('a003') && r.file !== 'error-400.json');
routes('risu', [
  ...risuRoutes,
  { url: '^https://realm\\.risuai\\.net/character/1f2e3d4c-0000-4000-8000-00000000a003/__data\\.json', file: 'meta-1f2e3d4c-0000-4000-8000-00000000a003.json' },
  { url: '^https://realm\\.risuai\\.net/api/v1/download/json-v2/1f2e3d4c-0000-4000-8000-00000000a003$', file: 'error-400.json', status: 400 },
  { url: '^https://realm\\.risuai\\.net/api/v1/download/charx-v3/1f2e3d4c-0000-4000-8000-00000000a003$', file: 'card-1f2e3d4c-0000-4000-8000-00000000a003.charx' },
]);

console.log('fixtures written');
