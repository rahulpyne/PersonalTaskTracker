-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  notes        text,
  category     text not null default 'work' check (category in ('work','personal')),
  priority     text not null default 'medium' check (priority in ('high','medium','low')),
  type         text,
  "group"      text,
  assigned_to  text,
  due_date     date,
  completed    boolean not null default false,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists audit_log (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid references tasks(id) on delete set null,
  action          text not null check (action in ('INSERT','UPDATE','DELETE')),
  before_snapshot jsonb,
  after_snapshot  jsonb,
  changed_at      timestamptz not null default now()
);

-- ── Auto-update updated_at ───────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_updated_at on tasks;
create trigger tasks_updated_at
  before update on tasks
  for each row execute function set_updated_at();

-- ── Audit trigger ────────────────────────────────────────────────────────────

create or replace function audit_task_changes()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (task_id, action, after_snapshot)
    values (new.id, 'INSERT', to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    insert into audit_log (task_id, action, before_snapshot, after_snapshot)
    values (new.id, 'UPDATE', to_jsonb(old), to_jsonb(new));
  elsif tg_op = 'DELETE' then
    insert into audit_log (task_id, action, before_snapshot)
    values (old.id, 'DELETE', to_jsonb(old));
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists tasks_audit on tasks;
create trigger tasks_audit
  after insert or update or delete on tasks
  for each row execute function audit_task_changes();

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table tasks     enable row level security;
alter table audit_log enable row level security;

-- Allow full access via anon key (single-user app; tighten for multi-user)
create policy "anon all tasks"     on tasks     for all to anon using (true) with check (true);
create policy "anon all audit_log" on audit_log for all to anon using (true) with check (true);

-- ── Realtime ─────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table audit_log;

-- ── Seed data ─────────────────────────────────────────────────────────────────
-- Matches the design's seed tasks (title, category, priority, notes)

insert into tasks (title, category, priority, notes) values
  ('Ship onboarding redesign v2',        'work',     'high',   'Review Figma w/ Mira at 3pm. Animation timings need polish.'),
  ('Reply to investor update thread',    'work',     'high',   ''),
  ('Draft Q3 OKRs',                      'work',     'medium', 'Focus on growth + retention. Cut nice-to-haves.'),
  ('1:1 prep with Sam',                  'work',     'medium', ''),
  ('Renew passport',                     'personal', 'high',   'Photos already taken — at coffee table folder.'),
  ('Book climbing gym membership',       'personal', 'low',    ''),
  ('Call mum',                           'personal', 'medium', ''),
  ('Pick up dry cleaning',              'personal', 'low',    ''),
  ('Read Chapter 4 — Designing for the Mind', 'personal', 'low', 'Highlight anything on perceived performance.'),
  ('Refactor analytics dashboard pipeline',   'work',     'medium', '')
on conflict do nothing;
