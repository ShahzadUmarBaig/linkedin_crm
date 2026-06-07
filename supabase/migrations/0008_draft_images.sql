-- Generated post visuals. image_urls holds the latest generated set (public Storage URLs);
-- selected_image_url is the one the user picked to attach when publishing.

alter table drafts add column if not exists image_urls         text[];
alter table drafts add column if not exists selected_image_url text;
