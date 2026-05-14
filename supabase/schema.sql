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

insert into tasks (title, category, priority, type, "group", due_date) values
  ('Design onboarding flow',     'work',     'high',   'feature', 'Q2 Launch',  current_date + 2),
  ('Fix login redirect bug',     'work',     'high',   'bug',     'Auth',       current_date),
  ('Write API documentation',    'work',     'medium', 'docs',    'Platform',   current_date + 7),
  ('Code review — payments PR',  'work',     'medium', 'review',  'Payments',   current_date + 1),
  ('Update dependencies',        'work',     'low',    'chore',   'Infra',      current_date + 14),
  ('Plan weekend trip',          'personal', 'medium', null,      null,         current_date + 10),
  ('Buy groceries',              'personal', 'low',    null,      null,         current_date),
  ('Read "Shape Up" book',       'personal', 'low',    null,      null,         null)
on conflict do nothing;
