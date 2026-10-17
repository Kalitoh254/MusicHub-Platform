ALTER TABLE auth_accounts
  ADD COLUMN IF NOT EXISTS handle TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS auth_accounts_handle_lower_unique
  ON auth_accounts (lower(handle))
  WHERE handle IS NOT NULL AND trim(handle) <> '';

CREATE INDEX IF NOT EXISTS auth_accounts_created_at_idx
  ON auth_accounts (created_at DESC);
