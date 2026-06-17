-- Outcome attribution (learning-loop Stage E): tie a generated draft to the real
-- LinkedIn post it became, so the engine can attribute actual performance back to its
-- own generation choices (hook, length, format, topic).
alter table scraped_posts add column draft_id uuid references drafts(id) on delete set null;
create index scraped_posts_draft_idx on scraped_posts (draft_id);
