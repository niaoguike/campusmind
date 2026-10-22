ALTER TABLE resources ADD COLUMN rag_revision BIGINT NOT NULL DEFAULT 1;
CREATE FUNCTION advance_resource_rag_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.title,NEW.description,NEW.tags,NEW.file_name,NEW.course_id)
     IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.tags,OLD.file_name,OLD.course_id) THEN
    NEW.rag_revision := OLD.rag_revision + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resource_rag_revision BEFORE UPDATE ON resources
  FOR EACH ROW EXECUTE FUNCTION advance_resource_rag_revision();
CREATE FUNCTION advance_course_resource_rag_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE resources SET rag_revision=rag_revision+1 WHERE course_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER course_resource_rag_revision AFTER UPDATE OF name ON courses
  FOR EACH ROW EXECUTE FUNCTION advance_course_resource_rag_revision();

ALTER TABLE resource_documents ADD COLUMN chunking_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE resource_documents ADD COLUMN source_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE resource_chunks ADD COLUMN section_title TEXT NOT NULL DEFAULT '';
ALTER TABLE resource_chunks ADD COLUMN parent_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE resource_chunks ADD COLUMN parent_content TEXT NOT NULL DEFAULT '';
ALTER TABLE resource_chunks ADD COLUMN page_end BIGINT;
ALTER TABLE resource_chunks ADD COLUMN parent_page_number BIGINT;
ALTER TABLE resource_chunks ADD COLUMN parent_page_end BIGINT;
ALTER TABLE resource_chunks ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE resource_chunks ADD COLUMN index_revision TEXT NOT NULL DEFAULT '';
ALTER TABLE resource_chunks ADD COLUMN resource_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE resource_chunks ADD COLUMN lexical_tokens TEXT NOT NULL DEFAULT '';
ALTER TABLE resource_chunks ADD COLUMN metadata_tokens TEXT NOT NULL DEFAULT '';
ALTER TABLE resource_chunks ADD COLUMN rag_search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple',metadata_tokens),'A') || setweight(to_tsvector('simple',lexical_tokens),'D')
) STORED;
CREATE INDEX resource_chunks_rag_search ON resource_chunks USING GIN(rag_search);

CREATE TABLE resource_chunk_vectors (
  chunk_id BIGINT NOT NULL REFERENCES resource_chunks(id) ON DELETE CASCADE,
  space_identity TEXT NOT NULL, content_hash TEXT NOT NULL, resource_revision BIGINT NOT NULL,
  embedding vector NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(chunk_id,space_identity)
);
CREATE TABLE resource_embedding_jobs (
  chunk_id BIGINT NOT NULL REFERENCES resource_chunks(id) ON DELETE CASCADE,
  space_identity TEXT NOT NULL, content_hash TEXT NOT NULL, resource_revision BIGINT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  next_at BIGINT NOT NULL DEFAULT 0, lease_until BIGINT NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '', PRIMARY KEY(chunk_id,space_identity)
);
CREATE INDEX resource_embedding_jobs_pending ON resource_embedding_jobs(space_identity,state,next_at,lease_until);
