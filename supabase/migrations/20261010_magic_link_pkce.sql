alter table public.magic_links
  add column if not exists code_challenge text,
  add column if not exists auth_code_hash text,
  add column if not exists auth_code_expires_at timestamptz,
  add column if not exists auth_code_used_at timestamptz;

create index if not exists idx_magic_links_auth_code on public.magic_links (auth_code_hash)
  where auth_code_hash is not null;
