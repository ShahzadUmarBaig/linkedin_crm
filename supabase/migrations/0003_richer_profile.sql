-- Phase 2: capture the richer set of profile fields LinkedIn surfaces on every profile page.
-- These are all extracted from the LinkedIn topcard / About / Top skills / Services / Featured
-- sections. We apply them to both `profile` (the user themselves) and `people` (everyone else
-- they look at) so competitor profiles get the same enrichment.

alter table profile add column if not exists location          text;
alter table profile add column if not exists follower_count    int;
alter table profile add column if not exists connection_count  int;
alter table profile add column if not exists top_skills        text[];
alter table profile add column if not exists services          text[];
alter table profile add column if not exists featured          jsonb not null default '[]'::jsonb;

alter table people  add column if not exists location          text;
alter table people  add column if not exists follower_count    int;
alter table people  add column if not exists connection_count  int;
alter table people  add column if not exists top_skills        text[];
alter table people  add column if not exists services          text[];
alter table people  add column if not exists featured          jsonb not null default '[]'::jsonb;
