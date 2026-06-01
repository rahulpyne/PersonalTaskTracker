-- Allow public (anon) read access to notes and tasks for the API edge function.
-- This is a personal single-user app; the API is protected at the edge function
-- level by the MCP_SECRET bearer token.

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_notes" ON notes;
CREATE POLICY "anon_select_notes"
  ON notes FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "anon_insert_notes" ON notes;
CREATE POLICY "anon_insert_notes"
  ON notes FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_notes" ON notes;
CREATE POLICY "anon_update_notes"
  ON notes FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "anon_delete_notes" ON notes;
CREATE POLICY "anon_delete_notes"
  ON notes FOR DELETE
  USING (true);
