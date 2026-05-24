create extension if not exists pgcrypto;

alter table public.licenses
  add column if not exists encrypted_license_key text,
  add column if not exists activation_usage_count integer,
  add column if not exists activation_limit integer;

create table if not exists public.license_activations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  license_key_masked text not null,
  device_fingerprint text not null,
  instance_id text,
  instance_name text,
  platform text,
  app_version text,
  bundle_id text,
  status text not null default 'active',
  activated_at timestamptz not null default now(),
  last_validated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.license_activations enable row level security;

create unique index if not exists license_activations_user_license_device_key
on public.license_activations (user_id, license_key_masked, device_fingerprint);
