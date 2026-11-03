-- Rate limits live in Postgres so they hold across API instances and restarts.
CREATE TABLE rate_limit (
  key                    text PRIMARY KEY,
  count                  int NOT NULL,
  reset_at               timestamptz NOT NULL
);
CREATE INDEX rate_limit_reset ON rate_limit (reset_at);

-- Webhook signing secrets: AES-256-GCM under WEBHOOK_SECRET_KEY. The version says which key
-- encrypted each secret, so keys can rotate without breaking existing endpoints.
ALTER TABLE webhook_endpoint ADD COLUMN key_version int NOT NULL DEFAULT 1;
