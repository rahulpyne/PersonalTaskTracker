-- ── Schema permissions (required for new Supabase projects) ──────────────────

grant usage on schema public to anon, authenticated;
grant all   on all tables    in schema public to anon, authenticated;
grant all   on all sequences in schema public to anon, authenticated;
alter default privileges in schema public
  grant all on tables    to anon, authenticated;
alter default privileges in schema public
  grant all on sequences to anon, authenticated;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists tasks (
  id         uuid        primary key default gen_random_uuid(),
  text       text        not null,
  type       text        not null default 'work'   check (type   in ('work','personal')),
  prio       text        not null default 'med'    check (prio   in ('high','med','low')),
  context    text        not null default '',
  done       boolean     not null default false,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  -- legacy columns kept for back-compat (ignored by app)
  cat        text        not null default '',
  assigned   text        not null default '',
  position   int         not null default 0
);

-- ── Auto-timestamp on completion ────────────────────────────────────────────

create or replace function set_done_at()
returns trigger language plpgsql as $$
begin
  if new.done and old.done is distinct from new.done then
    new.done_at = now();
  elsif not new.done then
    new.done_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_done_at on tasks;
create trigger tasks_done_at
  before update on tasks
  for each row execute function set_done_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table tasks enable row level security;

drop policy if exists "anon all tasks" on tasks;
create policy "anon all tasks" on tasks for all to anon using (true) with check (true);

-- ── Realtime ─────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table tasks;

-- ── Seed data ────────────────────────────────────────────────────────────────

insert into tasks (text, type, prio, context) values
  ('Ship onboarding redesign v2',             'work',     'high', 'Review Figma w/ Mira at 3pm. Animation timings need polish.'),
  ('Reply to investor update thread',         'work',     'high', ''),
  ('Draft Q3 OKRs',                           'work',     'med',  'Focus on growth + retention. Cut nice-to-haves.'),
  ('1:1 prep with Sam',                       'work',     'med',  ''),
  ('Renew passport',                          'personal', 'high', 'Photos already taken — at coffee table folder.'),
  ('Book climbing gym membership',            'personal', 'low',  ''),
  ('Call mum',                                'personal', 'med',  ''),
  ('Pick up dry cleaning',                    'personal', 'low',  ''),
  ('Read Chapter 4 — Designing for the Mind', 'personal', 'low',  'Highlight anything on perceived performance.'),
  ('Refactor analytics dashboard pipeline',   'work',     'med',  '')
on conflict do nothing;
