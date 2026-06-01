-- LinkedIn CRM — initial schema
-- Single-user MVP. Multi-user-ready via auth.users + RLS so we never have to retrofit later.

------------------------------------------------------------
-- Enums
------------------------------------------------------------
create type idea_status as enum ('proposed', 'selected', 'rejected', 'scheduled', 'posted');
create type slot_status as enum ('scheduled', 'posted', 'skipped');
create type ai_provider as enum ('anthropic', 'google');
create type engagement_type as enum ('reaction', 'comment', 'repost');
create type media_type as enum ('text', 'image', 'video', 'article', 'poll', 'document');

------------------------------------------------------------
-- Profile: AI-inferred from your own posts, user-editable
------------------------------------------------------------
create table profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  linkedin_url text,
  display_name text,
  headline text,
  niche text,
  audience text,
  tone text,
  pillars jsonb not null default '[]'::jsonb, -- [{name, description}]
  posting_frequency_per_week int not null default 3,
  inferred_at timestamptz,
  inference_source_post_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

------------------------------------------------------------
-- Settings: BYO API keys + model preferences
-- Keys are stored encrypted at the app layer before insert.
------------------------------------------------------------
create table settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  anthropic_api_key_encrypted text,
  google_api_key_encrypted text,
  default_provider ai_provider not null default 'anthropic',
  default_model text,
  task_model_overrides jsonb not null default '{}'::jsonb, -- {ideas: 'gemini-2.5-pro', drafts: 'claude-opus-4-7'}
  monthly_budget_warn_usd  numeric(10, 2),                 -- soft: surface a warning when crossed
  monthly_budget_hard_usd  numeric(10, 2),                 -- hard: block further AI runs when crossed
  updated_at timestamptz not null default now()
);

------------------------------------------------------------
-- People: connections + anyone who engages with your posts
------------------------------------------------------------
create table people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  linkedin_urn text,           -- LinkedIn's stable ID if scraped
  profile_url text,
  full_name text,
  headline text,
  company text,
  is_connection boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw jsonb,                   -- everything else the scrape captured
  unique (user_id, profile_url)
);

------------------------------------------------------------
-- Scraped posts (your own posts)
------------------------------------------------------------
create table scraped_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  linkedin_urn text not null,
  url text,
  posted_at timestamptz,
  body text,
  media media_type,
  topics text[],               -- AI-extracted on ingest, used for cross-post & competitor analysis
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  unique (user_id, linkedin_urn)
);

------------------------------------------------------------
-- Time-series metric snapshots so we can track post growth
-- Each scrape captures a fresh row per post — no overwriting.
------------------------------------------------------------
create table post_metric_snapshots (
  id bigserial primary key,
  post_id uuid not null references scraped_posts(id) on delete cascade,
  scrape_run_id uuid not null,
  impressions int,
  likes int,
  comments int,
  reposts int,
  captured_at timestamptz not null default now()
);

------------------------------------------------------------
-- Engagements: who engaged with which of your posts
------------------------------------------------------------
create table engagements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references scraped_posts(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  type engagement_type not null,
  reaction text,               -- like/celebrate/love/insightful/funny/support when type='reaction'
  comment_text text,
  engaged_at timestamptz,
  scrape_run_id uuid,
  -- One row per (post, person, type). On re-scrape we UPSERT, so:
  --   reaction changes (like → celebrate) update in place
  --   edited comments overwrite comment_text
  --   we do not preserve history in V1 (add a separate engagement_history table later if needed)
  unique (post_id, person_id, type)
);

------------------------------------------------------------
-- Inspiration posts: others' posts captured from your feed
------------------------------------------------------------
create table inspiration_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  linkedin_urn text,
  url text,
  author_person_id uuid references people(id) on delete set null,
  body text,
  media media_type,
  posted_at timestamptz,
  likes int,
  comments int,
  reposts int,
  topics text[],               -- AI-extracted on ingest
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  unique (user_id, linkedin_urn)
);

------------------------------------------------------------
-- Ideas: AI-generated, lifecycle: proposed → selected → scheduled → posted
------------------------------------------------------------
create table ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status idea_status not null default 'proposed',
  hook text,
  angle text,
  pillar text,
  source_type text,            -- 'inspiration_post' | 'own_post_pattern' | 'niche_research'
  source_inspiration_post_id uuid references inspiration_posts(id) on delete set null,
  source_scraped_post_id uuid references scraped_posts(id) on delete set null,
  ai_run_id uuid,
  generated_at timestamptz not null default now(),
  selected_at timestamptz,
  rejected_at timestamptz
);

------------------------------------------------------------
-- Drafts: solidified content, linked to an idea
------------------------------------------------------------
create table drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idea_id uuid references ideas(id) on delete set null,
  body text not null,
  version int not null default 1,
  ai_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

------------------------------------------------------------
-- Calendar slots: AI-picked date+time. User can override.
------------------------------------------------------------
create table calendar_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_id uuid references drafts(id) on delete set null,
  scheduled_for timestamptz not null,
  ai_chosen boolean not null default true,
  ai_reasoning text,
  status slot_status not null default 'scheduled',
  posted_at timestamptz,
  posted_post_id uuid references scraped_posts(id) on delete set null,
  created_at timestamptz not null default now()
);

------------------------------------------------------------
-- Scrape runs: one row per "Scrape" click in the extension
------------------------------------------------------------
create table scrape_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  posts_captured int not null default 0,
  inspiration_captured int not null default 0,
  people_captured int not null default 0,
  engagements_captured int not null default 0,
  source_pages text[],         -- which LinkedIn URLs the extension observed
  status text not null default 'running'
);

------------------------------------------------------------
-- AI runs: every AI call logged with token + cost for budget control
------------------------------------------------------------
create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task text not null,          -- 'profile_inference' | 'idea_generation' | 'draft_write' | 'schedule_slot' | 'topic_extract'
  provider ai_provider not null,
  model text not null,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10, 6),
  triggered_by_scrape_run_id uuid references scrape_runs(id) on delete set null,
  status text not null default 'success',
  error text,
  created_at timestamptz not null default now()
);

------------------------------------------------------------
-- Indexes
------------------------------------------------------------
create index on scraped_posts(user_id, posted_at desc);
create index on post_metric_snapshots(post_id, captured_at desc);
create index on engagements(user_id, post_id);
create index on engagements(person_id);
create index on inspiration_posts(user_id, posted_at desc);
create index on ideas(user_id, status, generated_at desc);
create index on drafts(user_id, idea_id);
create index on calendar_slots(user_id, scheduled_for);
create index on scrape_runs(user_id, started_at desc);
create index on ai_runs(user_id, created_at desc);
create index on people(user_id, last_seen_at desc);

------------------------------------------------------------
-- Row Level Security: user can only see their own data
------------------------------------------------------------
alter table profile                enable row level security;
alter table settings               enable row level security;
alter table people                 enable row level security;
alter table scraped_posts          enable row level security;
alter table post_metric_snapshots  enable row level security;
alter table engagements            enable row level security;
alter table inspiration_posts      enable row level security;
alter table ideas                  enable row level security;
alter table drafts                 enable row level security;
alter table calendar_slots         enable row level security;
alter table scrape_runs            enable row level security;
alter table ai_runs                enable row level security;

create policy own_rows on profile           for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on settings          for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on people            for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on scraped_posts     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on engagements       for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on inspiration_posts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on ideas             for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on drafts            for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on calendar_slots    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on scrape_runs       for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on ai_runs           for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- post_metric_snapshots inherits user ownership via its post
create policy own_rows on post_metric_snapshots for all
  using (exists (select 1 from scraped_posts p where p.id = post_id and p.user_id = auth.uid()))
  with check (exists (select 1 from scraped_posts p where p.id = post_id and p.user_id = auth.uid()));
