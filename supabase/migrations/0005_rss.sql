-- RSS / newsletter feeds as a second input source. The user adds feed URLs; the platform
-- fetches items daily (autopilot) or on demand. Items feed topic extraction → trends → ideas.

create table if not exists rss_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  title text,
  active boolean not null default true,
  last_fetched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (user_id, url)
);

create table if not exists rss_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feed_id uuid not null references rss_feeds(id) on delete cascade,
  guid text not null,            -- item guid, else the link
  url text,
  title text,
  author text,
  content text,                  -- full content (content:encoded) when present
  summary text,                  -- description / snippet
  published_at timestamptz,
  topics text[],                 -- AI-extracted, same pipeline as posts
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  unique (user_id, guid)
);

create index if not exists rss_feeds_user_idx on rss_feeds(user_id, created_at desc);
create index if not exists rss_items_user_idx on rss_items(user_id, published_at desc nulls last);
create index if not exists rss_items_feed_idx on rss_items(feed_id);

alter table rss_feeds enable row level security;
alter table rss_items enable row level security;

create policy own_rows on rss_feeds for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_rows on rss_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());
