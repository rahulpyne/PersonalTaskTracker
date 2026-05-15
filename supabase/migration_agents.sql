-- ── Agent pipeline schema additions ─────────────────────────────────────────
-- Run this in Supabase SQL Editor once before starting the agents.

-- Parent-child task hierarchy (subtasks link back to parent)
alter table tasks
  add column if not exists parent_id uuid references tasks(id) on delete cascade;

-- Deduplication: tracks which email generated this task
-- Format: "email:<gmailMessageId>"
alter table tasks
  add column if not exists source text not null default '';

-- Indexes for common agent queries
create index if not exists tasks_source_idx
  on tasks (source)
  where source != '';

create index if not exists tasks_parent_idx
  on tasks (parent_id)
  where parent_id is not null;

-- Grant service role access (already covered by anon policy, but explicit is safer)
grant all on tasks to service_role;
