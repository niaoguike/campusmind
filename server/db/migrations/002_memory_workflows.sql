CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS long_term_memory_jobs (
  message_id BIGINT PRIMARY KEY, user_id BIGINT NOT NULL, thread_id BIGINT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  next_at BIGINT NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '',
  lease_until BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS memory_jobs_pending ON long_term_memory_jobs(state,next_at,lease_until);
CREATE INDEX IF NOT EXISTS memory_jobs_user ON long_term_memory_jobs(user_id);

CREATE TABLE IF NOT EXISTS conversation_summary_jobs (
  thread_id BIGINT PRIMARY KEY REFERENCES agent_threads(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_message_id BIGINT NOT NULL, force INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  next_at BIGINT NOT NULL DEFAULT 0, lease_until BIGINT NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS summary_jobs_pending ON conversation_summary_jobs(state,next_at,lease_until);

CREATE TABLE IF NOT EXISTS agent_thread_summaries (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id BIGINT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  start_message_id BIGINT NOT NULL, end_message_id BIGINT NOT NULL,
  content TEXT NOT NULL, source_hash TEXT NOT NULL, embedding vector NOT NULL,
  space_identity TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), invalidated_at TIMESTAMPTZ,
  UNIQUE(user_id,thread_id,start_message_id,end_message_id),
  CHECK(start_message_id <= end_message_id)
);
CREATE INDEX IF NOT EXISTS summaries_user_idx ON agent_thread_summaries(user_id,thread_id,end_message_id);
CREATE TABLE IF NOT EXISTS memory_privacy_barriers (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  through_message_id BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS memory_erased_users (user_id BIGINT PRIMARY KEY);

CREATE TABLE IF NOT EXISTS sqlite_imports (
  source_hash TEXT PRIMARY KEY, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  report JSONB NOT NULL
);
