/** Plain versioned SQL migrations. Never edit a shipped migration; add a new one. */
export const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  {
    version: 1,
    name: 'initial',
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  totp_secret_enc TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE auth_failures (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE settings (
  owner_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (owner_id, key)
);
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  api_key_enc TEXT,
  params TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  character_id TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX media_owner ON media(owner_id, kind);
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT,
  card TEXT NOT NULL,
  top_extras TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  fav INTEGER NOT NULL DEFAULT 0,
  game TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_chat_at INTEGER
);
CREATE INDEX characters_owner ON characters(owner_id);
CREATE TABLE personas (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT,
  description TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  age INTEGER,
  age_stage TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE lorebooks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  scope_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX lorebooks_owner ON lorebooks(owner_id, scope, scope_id);
CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'prompt',
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT,
  members TEXT NOT NULL DEFAULT '[]',
  strategy TEXT NOT NULL DEFAULT 'natural',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  base_state TEXT NOT NULL,
  state TEXT NOT NULL,
  last_real_tick INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  character_id TEXT,
  group_id TEXT,
  title TEXT NOT NULL,
  persona_id TEXT,
  campaign_id TEXT,
  parent_chat_id TEXT,
  branch_message_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX chats_owner ON chats(owner_id, updated_at);
CREATE INDEX chats_character ON chats(character_id);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  character_id TEXT,
  swipe_id INTEGER NOT NULL DEFAULT 0,
  swipes TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  bookmarked INTEGER NOT NULL DEFAULT 0,
  extra TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX messages_chat ON messages(chat_id, seq);
CREATE TABLE op_log (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  message_id TEXT,
  swipe_id INTEGER,
  seq INTEGER NOT NULL,
  source TEXT NOT NULL,
  ops TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX op_log_campaign ON op_log(campaign_id, seq);
CREATE INDEX op_log_message ON op_log(message_id);
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  chat_id TEXT,
  character_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  upto_seq INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX memories_chat ON memories(chat_id);
CREATE TABLE diary (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  campaign_id TEXT,
  number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '{}',
  game_time INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE phone_messages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  from_player INTEGER NOT NULL,
  text TEXT NOT NULL,
  game_time INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX phone_thread ON phone_messages(campaign_id, npc_id, created_at);
CREATE TABLE helper_messages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  campaign_id TEXT,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  proposal TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  created_at INTEGER NOT NULL
);
CREATE TABLE lore_embeddings (
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  entry_uid TEXT NOT NULL,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  vector BLOB NOT NULL,
  PRIMARY KEY (book_id, entry_uid)
);
CREATE VIRTUAL TABLE search_fts USING fts5(
  owner_id UNINDEXED, campaign_id UNINDEXED, kind UNINDEXED, ref_id UNINDEXED, title, body,
  tokenize = 'porter unicode61'
);
`,
  },
  {
    version: 2,
    name: 'memory v2, call log',
    sql: `
-- Memories live beside campaign state, anchored to messages like op_log entries:
-- active when message_id is NULL, or the message exists in chat_id with a matching swipe.
CREATE TABLE mem_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  campaign_id TEXT,
  chat_id TEXT,
  message_id TEXT,
  swipe_id INTEGER,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  participants TEXT NOT NULL DEFAULT '[]',
  witnesses TEXT NOT NULL DEFAULT '[]',
  location_id TEXT,
  game_time INTEGER NOT NULL DEFAULT 0,
  importance INTEGER NOT NULL DEFAULT 1,
  secret INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  forgotten INTEGER NOT NULL DEFAULT 0,
  edited INTEGER NOT NULL DEFAULT 0,
  folded_into TEXT,
  seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX mem_items_campaign ON mem_items(campaign_id, seq);
CREATE INDEX mem_items_chat ON mem_items(chat_id, seq);
CREATE INDEX mem_items_message ON mem_items(message_id);
CREATE TABLE mem_heard (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  campaign_id TEXT,
  chat_id TEXT,
  message_id TEXT,
  swipe_id INTEGER,
  memory_id TEXT NOT NULL,
  viewer TEXT NOT NULL,
  distortion INTEGER NOT NULL,
  from_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX mem_heard_campaign ON mem_heard(campaign_id);
CREATE INDEX mem_heard_message ON mem_heard(message_id);
CREATE TABLE mem_facts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  campaign_id TEXT,
  chat_id TEXT,
  message_id TEXT,
  swipe_id INTEGER,
  source TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  supersedes TEXT,
  conflicts_with TEXT,
  cite TEXT,
  game_time INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX mem_facts_campaign ON mem_facts(campaign_id, entity_id);
CREATE INDEX mem_facts_chat ON mem_facts(chat_id);
CREATE INDEX mem_facts_message ON mem_facts(message_id);
CREATE TABLE mem_summaries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  campaign_id TEXT,
  chat_id TEXT,
  level TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  from_time INTEGER NOT NULL DEFAULT 0,
  to_time INTEGER NOT NULL DEFAULT 0,
  covers TEXT NOT NULL DEFAULT '[]',
  importance INTEGER NOT NULL DEFAULT 1,
  message_id TEXT,
  swipe_id INTEGER,
  edited INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX mem_summaries_campaign ON mem_summaries(campaign_id, level);
CREATE INDEX mem_summaries_chat ON mem_summaries(chat_id, level);
CREATE TABLE mem_vectors (
  item_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  model TEXT NOT NULL,
  hash TEXT NOT NULL,
  vector BLOB NOT NULL
);
CREATE VIRTUAL TABLE mem_fts USING fts5(
  item_id UNINDEXED, owner_id UNINDEXED, campaign_id UNINDEXED, chat_id UNINDEXED, kind UNINDEXED, text,
  tokenize = 'porter unicode61'
);
CREATE TABLE chronicle_state (
  chat_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  watermark_seq INTEGER NOT NULL DEFAULT 0,
  runs TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
CREATE TABLE llm_calls (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  chat_id TEXT,
  message_id TEXT,
  purpose TEXT NOT NULL,
  role TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  ms INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  first_token_ms INTEGER,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX llm_calls_owner ON llm_calls(owner_id, created_at);
CREATE INDEX llm_calls_chat ON llm_calls(chat_id, created_at);

-- Carry Phase 1 memory over. Long-term facts become world notes (they had no subject slot);
-- rolling chat summaries become chapter summaries. The old rows stay untouched.
INSERT INTO mem_facts (id, owner_id, campaign_id, chat_id, message_id, swipe_id, source, entity_id, entity_name, key, value, text, status, supersedes, conflicts_with, cite, game_time, seq, created_at, updated_at)
SELECT 'mf_' || m.id, m.owner_id, c.campaign_id, m.chat_id, NULL, NULL, 'migrated', 'world', 'World', 'note_' || m.id, m.text, m.text,
       'active', NULL, NULL, NULL, 0, COALESCE(m.upto_seq, 0), m.created_at, m.updated_at
FROM memories m LEFT JOIN chats c ON c.id = m.chat_id
WHERE m.kind = 'fact';
INSERT INTO mem_summaries (id, owner_id, campaign_id, chat_id, level, title, text, from_time, to_time, covers, importance, message_id, swipe_id, edited, seq, created_at, updated_at)
SELECT 'ms_' || c.id, c.owner_id, c.campaign_id, c.id, 'chapter', 'Story so far', json_extract(c.metadata, '$.memory.text'), 0, 0, '[]', 2, NULL, NULL,
       COALESCE(json_extract(c.metadata, '$.memory.pinned'), 0), COALESCE(json_extract(c.metadata, '$.memory.uptoSeq'), 0), c.updated_at, c.updated_at
FROM chats c
WHERE json_valid(c.metadata) AND COALESCE(json_extract(c.metadata, '$.memory.text'), '') <> '';
INSERT INTO mem_fts (item_id, owner_id, campaign_id, chat_id, kind, text)
SELECT id, owner_id, COALESCE(campaign_id, ''), COALESCE(chat_id, ''), 'fact', text FROM mem_facts;
INSERT INTO mem_fts (item_id, owner_id, campaign_id, chat_id, kind, text)
SELECT id, owner_id, COALESCE(campaign_id, ''), COALESCE(chat_id, ''), 'summary', text FROM mem_summaries;
`,
  },
  {
    version: 3,
    name: 'character library',
    sql: `
-- Library metadata kept beside the card: a local nickname, the creator, a token count and a
-- content hash (for duplicates), and a link to an online source.
ALTER TABLE characters ADD COLUMN display_name TEXT;
ALTER TABLE characters ADD COLUMN creator TEXT NOT NULL DEFAULT '';
ALTER TABLE characters ADD COLUMN tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE characters ADD COLUMN source TEXT;
CREATE TABLE character_versions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  card TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT '{}',
  avatar TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX character_versions_char ON character_versions(character_id, created_at);
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'folder',
  color TEXT NOT NULL DEFAULT 'accent',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX collections_owner ON collections(owner_id, position);
CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (collection_id, character_id)
);
CREATE INDEX collection_items_char ON collection_items(character_id);
-- Deleted characters are kept for a short while so a delete can be undone.
CREATE TABLE character_trash (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE provider_accounts (
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  token_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, provider)
);
CREATE TABLE provider_cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`,
  },
  {
    version: 4,
    name: 'phase 3 communication',
    sql: `
-- Group texts (npc_id "group:<id>" with the speaker kept per message) and phone calls.
ALTER TABLE phone_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE phone_messages ADD COLUMN speaker_id TEXT;
`,
  },
];
