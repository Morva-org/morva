-- Onboarding: logos (in Postgres until object storage exists), the $2 test payment, and the
-- relayer's record of passkey intents it submitted.

CREATE TABLE merchant_logo (
  merchant_id            uuid PRIMARY KEY REFERENCES merchant(id) ON DELETE CASCADE,
  content_type           text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  bytes                  bytea NOT NULL CHECK (octet_length(bytes) <= 262144),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- The merchant pays themselves $2 from Base to see checkout, then refunds it with their passkey.
CREATE TABLE test_payment (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id            uuid NOT NULL REFERENCES merchant(id) ON DELETE CASCADE,
  refund_address         text NOT NULL,
  deposit_address        text NOT NULL,
  amount_in              text NOT NULL,
  quote                  jsonb NOT NULL,
  status                 text NOT NULL DEFAULT 'PENDING_DEPOSIT',
  received_amount        text,
  refund_deposit_address text,
  refund_payload         text,
  refund_intent_hash     text,
  refund_status          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX test_payment_merchant ON test_payment (merchant_id, created_at DESC);

-- Every passkey-signed key intent the relayer submitted. The relayer never builds or edits them.
CREATE TABLE relayer_submission (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id            uuid NOT NULL REFERENCES merchant(id) ON DELETE CASCADE,
  intent                 text NOT NULL CHECK (intent IN ('add_public_key', 'remove_public_key')),
  public_key             text NOT NULL,
  tx_hash                text,
  status                 text NOT NULL,
  error                  text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
