create table if not exists public.whats_new_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  channel text not null default 'release',
  release_date text not null,
  features jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whats_new_releases enable row level security;

create unique index if not exists whats_new_releases_version_channel_key
on public.whats_new_releases (version, channel);
