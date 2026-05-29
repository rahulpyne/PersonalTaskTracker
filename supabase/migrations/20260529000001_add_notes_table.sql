-- Notes table for the personal knowledge base
CREATE TABLE IF NOT EXISTS notes (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  title       TEXT        NOT NULL DEFAULT '',
  body        TEXT        NOT NULL DEFAULT '',
  tags        TEXT[]      DEFAULT '{}',
  pinned      BOOLEAN     DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Index for tag search
CREATE INDEX IF NOT EXISTS notes_tags_idx ON notes USING GIN (tags);
-- Index for text search
CREATE INDEX IF NOT EXISTS notes_fts_idx ON notes USING GIN (
  to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))
);
