-- Store the detailed AI-generated image-generation prompt alongside each draft, so Compose can
-- show (and the user can edit / feed to an image model) a rich prompt instead of a generic stub.

alter table drafts add column if not exists image_prompt text;
