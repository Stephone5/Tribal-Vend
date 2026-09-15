-- Earl's database for Tribal Vend. Run this once in a NEW Supabase project:
-- Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- Ported from the Bridge migrations (commander messages, summaries, session
-- notes, debriefs, action steps, and 008 memory system). One member, no users table.

create extension if not exists vector;

create table if not exists commander_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  message_role text not null check (message_role in ('user', 'assistant', 'system_note')),
  message_content text not null,
  soul_version text,
  created_at timestamptz not null default now()
);
create index if not exists idx_cmdr_msg_user on commander_messages(user_id, created_at desc);
create index if not exists idx_cmdr_msg_session on commander_messages(session_id);

create table if not exists commander_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  summary text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_cmdr_sum_user on commander_summaries(user_id, created_at desc);

create table if not exists commander_session_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  operator_insights jsonb,
  strategic_ground jsonb,
  unresolved_threads jsonb,
  conversation_turn_count integer,
  generated_at timestamptz not null default now()
);
create index if not exists idx_csn_user on commander_session_notes(user_id, generated_at desc);

create table if not exists session_debriefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid not null,
  summary text not null,
  shift_detected boolean default false,
  unresolved_item text,
  dismissed boolean default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_debrief_user on session_debriefs(user_id, created_at desc);

create table if not exists action_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  step_text text not null,
  status text not null default 'active' check (status in ('active', 'completed', 'did_not_happen')),
  target_date date,
  source_session_id uuid,
  follow_up_answer text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_action_steps_user on action_steps(user_id, status);

-- Memory system (Bridge migration 008)
create table if not exists member_profiles (
  user_id uuid primary key,
  profile text not null,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  fact text not null,
  embedding vector(384),
  first_seen timestamptz not null default now(),
  last_confirmed timestamptz not null default now(),
  superseded_by uuid,
  source_session uuid,
  created_at timestamptz not null default now()
);
create index if not exists memory_facts_user_idx on memory_facts (user_id);

create table if not exists decision_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  topic text not null,
  conclusion text not null,
  reasoning text,
  status text not null default 'open' check (status in ('resolved','deflected','open')),
  decided_at timestamptz,
  last_touched timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists decision_ledger_user_idx on decision_ledger (user_id);

create table if not exists memory_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid,
  env text not null,
  kind text not null default 'session',
  processed boolean not null default false,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists memory_outbox_pending_idx on memory_outbox (env, processed, created_at);

create or replace function match_memory_facts(p_user_id uuid, p_query vector(384), p_count int)
returns table(id uuid, fact text, similarity float, first_seen timestamptz, last_confirmed timestamptz)
language sql stable as $$
  select id, fact, 1 - (embedding <=> p_query) as similarity, first_seen, last_confirmed
  from memory_facts
  where user_id = p_user_id and superseded_by is null and embedding is not null
  order by embedding <=> p_query
  limit p_count;
$$;

-- Only the server (service key) touches these tables.
alter table commander_messages enable row level security;
alter table commander_summaries enable row level security;
alter table commander_session_notes enable row level security;
alter table session_debriefs enable row level security;
alter table action_steps enable row level security;
alter table member_profiles enable row level security;
alter table memory_facts enable row level security;
alter table decision_ledger enable row level security;
alter table memory_outbox enable row level security;
