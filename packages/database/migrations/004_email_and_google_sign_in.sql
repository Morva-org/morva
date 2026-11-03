-- Merchants can sign up with an email code or Google. Their NEAR Intents account comes later,
-- from the passkey they create to protect their balance, so it is empty until then. Email and
-- Google sign-in reach the dashboard only; moving money always needs a passkey.

ALTER TABLE merchant ALTER COLUMN intents_account_id DROP NOT NULL;
ALTER TABLE merchant ADD COLUMN google_sub text UNIQUE;

-- One merchant per verified email address, so an email can always find its account.
CREATE UNIQUE INDEX merchant_verified_email ON merchant (lower(contact_email)) WHERE contact_email_verified_at IS NOT NULL;

-- Sign-in codes: 6 digits, stored as an HMAC, five attempts, ten minutes.
CREATE TABLE login_code (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  text NOT NULL,
  code_hash              bytea NOT NULL,
  attempts               int NOT NULL DEFAULT 0,
  expires_at             timestamptz NOT NULL,
  consumed_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_code_email ON login_code (email, created_at DESC);

-- Google OAuth: single-use state with its PKCE verifier.
CREATE TABLE oauth_state (
  state                  text PRIMARY KEY,
  code_verifier          text NOT NULL,
  expires_at             timestamptz NOT NULL,
  used_at                timestamptz
);
