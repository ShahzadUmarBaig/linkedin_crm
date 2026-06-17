-- Inspiration-post engagement history.
-- inspiration_posts only keeps the LATEST counts (it's upserted on re-capture), so we
-- lose velocity — the strongest "what's hot" signal. This table records one snapshot per
-- scrape, mirroring post_metric_snapshots (which already exists for the user's own posts),
-- so we can see how others' posts accelerate over time.
create table inspiration_metric_snapshots (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  inspiration_post_id uuid not null references inspiration_posts(id) on delete cascade,
  scrape_run_id uuid,
  likes int,
  comments int,
  reposts int,
  captured_at timestamptz not null default now()
);

create index inspiration_metric_snapshots_post_idx
  on inspiration_metric_snapshots (inspiration_post_id, captured_at desc);
create index inspiration_metric_snapshots_user_idx
  on inspiration_metric_snapshots (user_id, captured_at desc);

alter table inspiration_metric_snapshots enable row level security;
create policy own_rows on inspiration_metric_snapshots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
