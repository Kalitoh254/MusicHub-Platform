CREATE TABLE IF NOT EXISTS auth_email_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES auth_accounts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_email_codes_account_idx
  ON auth_email_verification_codes(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_email_codes_expiry_idx
  ON auth_email_verification_codes(expires_at);
