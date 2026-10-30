# Web application

The single Next.js app for the hackathon. Today it is the landing page. During the NEAR Hackathon (from 1 November 2026) it will also gain:

- `/pay/[id]`: the hosted checkout and payment links.
- `/dashboard`: the merchant console for orders, holds, refunds, payouts and settings.

After the hackathon it may split into `apps/app` (marketing site and dashboard, `app.morva.xyz`) and `apps/checkout` (hosted pay pages, `pay.morva.xyz`), as PRD §15 describes. Separate subdomains keep checkout security headers strict and make iframe embedding safe.

From the repository root, run `npm ci` and `npm run dev`, then open http://localhost:3000. Run `npm run build` for a production build and `npm run typecheck` for TypeScript checks. The landing page needs no environment variables.

The landing page's checkout is a simulation: it does not connect a wallet or move funds. The web app must never mark a payment paid itself. Order state belongs to `apps/api`.
