-- Allow logging fal.ai image-generation runs in ai_runs for cost visibility.
alter type ai_provider add value if not exists 'fal';
