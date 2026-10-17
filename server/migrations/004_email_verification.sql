CREATE TABLE IF NOT EXISTS auth_email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_email_verification_account_idx
  ON auth_email_verification_tokens(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_email_verification_expiry_idx
  ON auth_email_verification_tokens(expires_at);
