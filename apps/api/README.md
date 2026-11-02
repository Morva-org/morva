# API service

Node + Hono backend for merchants. PRD §11, §13, §14, §16. It never holds funds or any key that can move them: a merchant's money is controlled by their passkeys, whose private keys stay on their devices.

## What's built (merchant onboarding, Step 2)

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/auth/register/options`, `/verify` | Sign up with a passkey. Requires discoverable, user-verified ES256 passkeys on `RP_ID`. Creates the merchant, whose NEAR Intents account is derived from the passkey (`docs/PAYMENT_SPIKE.md`, finding 13) |
| `POST /v1/auth/login/options`, `/verify` | Log in with any of the merchant's passkeys |
| `POST /v1/auth/logout` | Ends the session |
| `GET /v1/me` | The signed-in merchant and their passkeys |
| `GET /v1/handles/:handle` | Live handle availability, with a plain reason |
| `POST /v1/me/email`, `/verify` | Contact email with a 6-digit code (an HMAC is stored, with five attempts and a ten-minute expiry). Email can never move funds |

- **Sessions:** a random token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Only its sha256 is stored.
- **CSRF:** state-changing requests must carry `Origin: WEB_ORIGIN`.
- **Rate limits:** sign-up, login, handle checks and email codes are limited in memory, which is fine for one instance.

### Onboarding (Step 3)

| Endpoint | Purpose |
| --- | --- |
| `PATCH /v1/onboarding/business`, `/payout`, `/channels`, `/defaults` | Autosave for each screen, validated as it saves |
| `POST /v1/onboarding/logo`, `GET /v1/logos/:id` | Logo: PNG, JPEG or WebP, up to 256 KB. Stored in Postgres until object storage exists |
| `POST /v1/onboarding/step` | Moves forward only when the step is complete or skippable; stores the furthest step so a merchant resumes there |
| `POST /v1/onboarding/terms`, `/live` | Accept the terms, then go live (needs a business, a confirmed email and the terms) |
| `POST /v1/me/passkeys/options`, `/verify` | Add a backup passkey |
| `GET /v1/intents/salt` | The Verifier's current nonce salt, for the browser to build the key intent |
| `POST /v1/relayer/key-intents` | The relayer (below) |
| `POST /v1/onboarding/test-payment`, `GET …`, `POST …/refund`, `…/refund/submit` | The $2 test payment from Base and its passkey-signed refund |

**The relayer** (`src/relayer.ts`):
- **What it accepts:** only already-signed `add_public_key` and `remove_public_key` intents for the merchant's own account, signed by one of their registered passkeys. It never builds or alters one.
- **What it rejects, before simulating:** other accounts, other intents, unknown keys, extra fields, and removing the last device.
- **How it submits:** it runs `simulate_intents` first, then `execute_intents` with the gas wallet, rate-limited per merchant. After each submission it logs a warning when the wallet's balance is low.

**Payout changes after go-live** return `signature_required`. The passkey-signed flow comes with the dashboard (Step 4).

**Infrastructure:**
- **Rate limits:** stored in Postgres (`rate_limit`).
- **Webhook secrets:** sealed with AES-256-GCM, with a `key_version` for rotation.
- **Email:** sent through Resend, or printed to the console when `RESEND_API_KEY` is unset.
- **1Click outages:** become a plain 503 that the screen shows ("you can skip this step").

## Run

```sh
cp .env.example .env              # set DATABASE_URL, RP_ID, WEB_ORIGIN, SESSION_SECRET
npm run migrate --workspace=@morva/database
npm run dev --workspace=@morva/api
npm test --workspace=@morva/api   # real WebAuthn responses from a software authenticator, on PGlite
```

## Next

- **Dashboard (Step 4):** payment links, withdrawals, passkey-signed payout changes and device removal.
- **[`worker/`](worker/README.md):** background jobs.
