alter table public.licenses add column if not exists license_key_hmac text;
create unique index if not exists licenses_license_key_hmac_key
  on public.licenses (license_key_hmac) where license_key_hmac is not null;
