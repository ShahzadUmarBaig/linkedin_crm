-- Idea scoring + topics. score is a 1-100 blend of the model's quality read, trend match,
-- and the user's historical performance on the idea's topics. topics drive the trend match
-- and are shown on the Ideas screen.

alter table ideas add column if not exists score  int;
alter table ideas add column if not exists topics text[];

create index if not exists ideas_user_status_score_idx on ideas(user_id, status, score desc nulls last);
