-- Earl for Tribal Vend, part 2: the setup interview and goals.
-- Run once in the same Supabase project: SQL Editor → New query → paste → Run.
-- Ported from the Bridge migration 004 (member_state, intake_responses,
-- member_benchmarks, benchmark_ratings) and 005 (action step → goal link).

create table if not exists member_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  stage_1_complete boolean default false,
  stage_2_complete boolean default false,
  stage_3_complete boolean default false,
  stage_1_completed_at timestamptz,
  stage_2_completed_at timestamptz,
  stage_3_completed_at timestamptz,
  hidden_metrics jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists intake_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  round integer not null default 1,
  stage integer not null,
  question_field text not null,
  answer text,
  follow_up_question text,
  follow_up_answer text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, round, question_field)
);
create index if not exists idx_intake_resp_lookup on intake_responses(user_id, round, stage);

create table if not exists member_benchmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  statement text not null,
  position integer default 0,
  starting_rating integer,
  current_rating integer,
  approved boolean default false,
  active boolean default true,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_benchmark_user on member_benchmarks(user_id);

create table if not exists benchmark_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  benchmark_id uuid references member_benchmarks(id) on delete cascade,
  rating integer not null,
  source text default 'initial',
  created_at timestamptz default now()
);

alter table action_steps add column if not exists benchmark_id uuid references member_benchmarks(id) on delete set null;

alter table member_state enable row level security;
alter table intake_responses enable row level security;
alter table member_benchmarks enable row level security;
alter table benchmark_ratings enable row level security;
