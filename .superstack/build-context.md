# Build context

```yaml
product: Morva, the commerce layer on NEAR Intents (see docs/Morva_PRD_v2.pdf)
event: NEAR Hackathon, 1-14 November 2026; judging 16-18 November
stack:
  workspace: npm workspaces (only apps/web is a workspace today)
  web: Next.js 16 + React 19 (apps/web; checkout and dashboard routes added during the hackathon)
  api: Node + Hono (apps/api), planned
  worker: pg-boss on Postgres (apps/api/worker), planned
  database: PostgreSQL (packages/database), planned
  routing: NEAR Intents 1Click API (packages/intents), planned
  contracts: Rust near-sdk escrow (contracts/escrow), planned
  agent: NEAR Shade Agent (agents/ops-agent), stretch
  spike: scripts/payment-spike.mjs (Node 24, viem for erc191 signing)
architecture:
  pattern: non-custodial commerce layer over NEAR Intents
  decisions:
    - EXACT_OUTPUT quotes, so the merchant receives the exact invoice amount
    - merchant settlement lands in the merchant's own NEAR Intents balance
    - every quote sets refundTo; exchange payers must give a refund address
    - escrow contract provides holds; the Verifier has none
    - API and worker own order state; the web app never marks orders paid
    - 1Click API key and webhook secrets stay server-side
  open:
    - escrow receives via Verifier balance vs ft_on_transfer (spike findings 7-8)
    - meaning of "one signature" for the multi-chain unified balance (spike finding 3)
build_status:
  mvp_complete: false
  tests_passing: spike unit tests only
  testnet_deployed: false
planning_status: gate 1 spike in progress (27-31 October 2026)
```

No product code exists yet, by design. Product features are built during the hackathon. Before then, the repository holds structure, plans, the landing page and the spike.
