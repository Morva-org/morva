-- Merchants, their passkeys and sessions. Nothing here can move funds: a merchant's money is
-- controlled by their passkeys, whose private keys never leave their devices.

CREATE TABLE merchant (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle                 text UNIQUE
                           CHECK (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(handle) BETWEEN 3 AND 30),
  business_name          text CHECK (length(business_name) <= 120),
  logo_url               text,
  country                char(2),
  contact_email          text,
  contact_email_verified_at timestamptz,
  -- Derived from the first passkey: "0x" + keccak256("p256" || key)[12..32]. Never changes.
  intents_account_id     text NOT NULL UNIQUE CHECK (intents_account_id ~ '^0x[0-9a-f]{40}$'),
  settlement_asset       text NOT NULL DEFAULT 'USDC',
  payout_mode            text NOT NULL DEFAULT 'keep_in_balance'
                           CHECK (payout_mode IN ('keep_in_balance', 'auto_payout')),
  payout_chain           text,
  payout_address         text,
  -- Smallest units of the settlement asset (USDC: 6 decimals).
  payout_threshold       bigint CHECK (payout_threshold >= 0),
  refund_policy_default  text NOT NULL DEFAULT 'full_to_source'
                           CHECK (refund_policy_default IN ('full_to_source', 'none')),
  hold_by_default        boolean NOT NULL DEFAULT false,
  confidential_default   boolean NOT NULL DEFAULT false,
  sales_channels         text[] NOT NULL DEFAULT '{payment_links}',
  terms_accepted_at      timestamptz,
  onboarding_step        text NOT NULL DEFAULT 'business',
  live_at                timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (payout_mode = 'keep_in_balance' OR (payout_chain IS NOT NULL AND payout_address IS NOT NULL))
);

CREATE TABLE passkey (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id            uuid NOT NULL REFERENCES merchant(id) ON DELETE CASCADE,
  -- WebAuthn credential ID, base64url.
  credential_id          text NOT NULL UNIQUE,
  -- COSE public key from registration, used to verify logins and signed actions.
  public_key             bytea NOT NULL,
  -- The same key as the Verifier encodes it ("p256:" + base58(x || y)), used for intents.
  public_key_p256        text NOT NULL,
  sign_count             bigint NOT NULL DEFAULT 0,
  transports             text[] NOT NULL DEFAULT '{}',
  backed_up              boolean NOT NULL DEFAULT false,
  device_label           text,
  -- The first passkey is implicitly registered on intents.near; later ones by a signed intent.
  registered_on_verifier_at timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  last_used_at           timestamptz,
  removed_at             timestamptz
);
CREATE INDEX passkey_merchant ON passkey (merchant_id) WHERE removed_at IS NULL;

CREATE TABLE api_key (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id            uuid NOT NULL REFERENCES merchant(id) ON DELETE CASCADE,
  prefix                 text NOT NULL UNIQUE,
  -- sha256 of the full key; the key itself is shown once and never stored.
  hash                   bytea NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  revoked_at             timestamptz
);

CREATE TABLE webhook_endpoint (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id            uuid NOT NULL REFERENCES merchant(id) ON DELETE CASCADE,
  url                    text NOT NULL CHECK (url ~ '^https://'),
  -- The signing secret, encrypted with the server's WEBHOOK_SECRET_KEY. It has to be recoverable
  -- to sign deliveries, so it can't be a one-way hash. It can't move funds.
  secret_encrypted       bytea NOT NULL,
  events                 text[] NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now(),
  disabled_at            timestamptz
);

CREATE TABLE audit_event (
  id                     bigserial PRIMARY KEY,
  merchant_id            uuid REFERENCES merchant(id) ON DELETE SET NULL,
  type                   text NOT NULL,
  detail                 jsonb NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_event_merchant ON audit_event (merchant_id, created_at DESC);

-- Sessions: the cookie holds a random token; only its sha256 is stored.
CREATE TABLE session (
  token_hash             bytea PRIMARY KEY,
  merchant_id            uuid NOT NULL REFERENCES merchant(id) ON DELETE CASCADE,
  created_at             timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  last_seen_at           timestamptz NOT NULL DEFAULT now(),
  user_agent             text
);
CREATE INDEX session_merchant ON session (merchant_id);

-- WebAuthn challenges, single use and short lived. `action_hash` binds a signature to one change.
CREATE TABLE webauthn_challenge (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose                text NOT NULL CHECK (purpose IN ('register', 'login', 'add_device', 'action')),
  challenge              text NOT NULL,
  merchant_id            uuid REFERENCES merchant(id) ON DELETE CASCADE,
  user_handle            text,
  action_hash            text,
  expires_at             timestamptz NOT NULL,
  used_at                timestamptz
);

-- Email verification codes: 6 digits, stored as an HMAC, five attempts, ten minutes.
CREATE TABLE email_code (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id            uuid NOT NULL REFERENCES merchant(id) ON DELETE CASCADE,
  email                  text NOT NULL,
  code_hash              bytea NOT NULL,
  attempts               int NOT NULL DEFAULT 0,
  expires_at             timestamptz NOT NULL,
  consumed_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_code_merchant ON email_code (merchant_id, created_at DESC);
