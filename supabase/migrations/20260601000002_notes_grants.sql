-- Grant full access on notes to the anon and authenticated roles
-- (tasks already has these; notes was missing them)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE notes TO anon, authenticated;
