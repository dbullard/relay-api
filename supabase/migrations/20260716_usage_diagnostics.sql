create table if not exists public.relay_user_presence (
  user_id text not null references public.users(id) on delete cascade,
  installation_id uuid not null,
  platform text not null check (platform in ('macos', 'ios')),
  app_version text not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, installation_id)
);

create index if not exists relay_user_presence_last_seen_at_idx
  on public.relay_user_presence(last_seen_at desc);

alter table public.relay_user_presence enable row level security;
