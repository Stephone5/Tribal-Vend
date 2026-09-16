-- Leads: the two prospect lists, and the research Earl can search.
-- Run once in the same Supabase project: SQL Editor → New query → paste → Run.

create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  anchor text not null check (anchor in ('shop', 'home')),
  name text not null,
  category text,
  tier int not null default 2,          -- 1 = the big anchors, 2 = the ranked list
  score int,
  miles numeric,
  food_ft int,
  headcount text,                       -- only where it's published
  addr text,
  phone text,
  website text,
  lat numeric,
  lon numeric,
  note text,                            -- what the research found
  status text not null default 'new' check (status in ('new', 'called', 'interested', 'no', 'later')),
  my_note text,                         -- what Stephen writes after a call
  contacted_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (anchor, name, addr)
);
create index if not exists prospects_pick_idx on prospects (anchor, status, score desc);

-- The research files, split into sections so Earl can pull one section instead
-- of the whole document.
create table if not exists research_sections (
  id uuid primary key default gen_random_uuid(),
  doc text not null,                    -- file it came from
  heading text not null,
  body text not null,
  updated_at timestamptz not null default now(),
  unique (doc, heading)
);
create index if not exists research_doc_idx on research_sections (doc);

alter table prospects enable row level security;
alter table research_sections enable row level security;
