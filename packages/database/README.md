# Database package

Postgres schema, migrations and typed queries. PRD §13.

- **`migrations/*.sql`:** applied in order by `migrate(db)`, each in a transaction. Recorded in `schema_migration`.
- **`src/db.ts`:** a minimal `Db` interface. `connectPostgres(url)` uses node-postgres in production. `connectMemory()` uses PGlite, the same Postgres engine in-process, for tests.
- **`src/repo.ts`:** queries for merchants, passkeys, sessions, WebAuthn challenges, email codes and the audit log.

Tables so far:
- `merchant`
- `passkey`
- `api_key` (hash only)
- `webhook_endpoint` (signing secret encrypted, since it must be recoverable to sign)
- `audit_event`
- `session` (token hash only)
- `webauthn_challenge` (single use)
- `email_code` (HMAC only)

There's no `near_account_id`: `intents_account_id` is derived from the merchant's first passkey and never changes.

```sh
npm run migrate --workspace=@morva/database   # uses DATABASE_URL
npm test --workspace=@morva/database
```
