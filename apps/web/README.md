# Web application

The single Next.js app for the hackathon. Today it is the landing page. During the NEAR Hackathon (from 1 November 2026) it will also gain:

- `/pay/[id]`: the hosted checkout and payment links.
- `/dashboard`: the merchant console for orders, holds, refunds, payouts and settings.

After the hackathon it may split into `apps/app` (marketing site and dashboard, `app.morva.xyz`) and `apps/checkout` (hosted pay pages, `pay.morva.xyz`), as PRD §15 describes. Separate subdomains keep checkout security headers strict and make iframe embedding safe.

From the repository root, run `npm ci` and `npm run dev`, then open http://localhost:3000. Run `npm run build` for a production build and `npm run typecheck` for TypeScript checks. The landing page needs no environment variables.

The landing page's checkout is a simulation: it does not connect a wallet or move funds. The web app must never mark a payment paid itself. Order state belongs to `apps/api`.

## Merchant onboarding (`/start`)

Eleven screens with one question each: welcome, create passkey, your business, email, how you get paid, how you sell, order defaults, backup device, terms, test payment, and you're live.

- **Saving and resuming:** answers save as the merchant types. The API stores the furthest step reached, so a merchant who closes the tab picks up where they left off on any device, after logging in with their passkey.
- **Same site:** `next.config.ts` routes `/api/v1/*` to the API (`API_ORIGIN`). The session cookie stays first-party and passkeys share one origin.
- **Passkeys:** sign-up, login, the backup device and the test-payment refund all use passkeys (`@simplewebauthn/browser`). Intents are signed over sha256 of the exact payload, with low-S signatures (`@morva/intents`).
- **QR codes:** generated in the browser with the Return mark in the centre, at error-correction level H. They download as PNG or SVG.
