create table if not exists public.legacy_license_traffic (
  day date not null,
  endpoint text not null,
  client_fingerprint text not null,
  app_version text,
  calls integer not null default 1,
  primary key (day, endpoint, client_fingerprint)
);

alter table public.legacy_license_traffic enable row level security;

create index if not exists legacy_license_traffic_day_idx on public.legacy_license_traffic (day);
