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

## Run

```sh
cp .env.example .env              # set DATABASE_URL, RP_ID, WEB_ORIGIN, SESSION_SECRET
npm run migrate --workspace=@morva/database
npm run dev --workspace=@morva/api
npm test --workspace=@morva/api   # real WebAuthn responses from a software authenticator, on PGlite
```

## Next

- **Passkey relayer:** submits passkey-signed `add_public_key` and `remove_public_key` intents and pays NEAR gas (finding 18). Needed for the backup-device screen.
- **Onboarding endpoints:** autosave the onboarding steps.
- **Dashboard:** payment links, withdrawals and the other Step 4 endpoints.
- **[`worker/`](worker/README.md):** background jobs.
