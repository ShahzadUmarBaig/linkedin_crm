-- Add `bio` (LinkedIn "About" section text) to profile + people.
-- Captured directly from the topcard's About section by the extension. It's the single
-- richest voice ground we can get on a person without inference.

alter table profile add column if not exists bio text;
alter table people  add column if not exists bio text;
