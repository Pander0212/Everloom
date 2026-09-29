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
];
