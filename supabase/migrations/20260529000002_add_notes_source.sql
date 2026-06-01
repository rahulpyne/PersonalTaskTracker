-- Add source tracking to notes so the import agent can deduplicate
ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS source     TEXT DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

-- Unique index on source_ref so we never import the same session twice
CREATE UNIQUE INDEX IF NOT EXISTS notes_source_ref_idx
  ON notes(source_ref)
  WHERE source_ref IS NOT NULL;
