-- Autopilot: nightly pipeline that tops up topics + ideas so approvals are waiting each morning.
-- The toggle lives on settings; last_autopilot_run_at is stamped by the cron job.

alter table settings add column if not exists autopilot_enabled       boolean not null default true;
alter table settings add column if not exists last_autopilot_run_at   timestamptz;
