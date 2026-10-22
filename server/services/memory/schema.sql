CREATE TABLE IF NOT EXISTS campusmind_memory_space (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  identity TEXT NOT NULL,
  dimensions INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campusmind_memories (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL,
  memory_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('preference', 'goal', 'weakness')),
  content TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '',
  source_thread_id BIGINT,
  source_message_id BIGINT,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  authority TEXT NOT NULL DEFAULT 'automatic' CHECK (authority IN ('automatic', 'user')),
  revision INTEGER NOT NULL DEFAULT 1,
  embedding vector(__DIMENSIONS__),
  expires_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, memory_key)
);
CREATE INDEX IF NOT EXISTS campusmind_memories_user ON campusmind_memories (user_id, updated_at DESC);
