# morva

**Every wallet. Every chain. One way to get paid.**

Morva lets any business get paid by anyone holding crypto, from any wallet, on any chain, in the currency the business wants. Built on NEAR Intents.

> Status: pre-build. The landing page exists, and the payment spike is in progress. The product is being built during the NEAR Hackathon, 1–14 November 2026. Nothing here takes real payments yet.

## The problem

Demand to pay with crypto is real, but checkout loses people in the gap between holding crypto and spending it:

- picking the wrong network;
- payments that arrive short;
- refunds that bounce between merchant and processor;
- having USDC but no gas;
- signing fear;
- money scattered across chains.

NEAR Intents and its 1Click API solve routing: a buyer pays from almost any chain, and the merchant receives the asset they chose. But 1Click is a swap API, not a commerce system. It has no orders, holds, merchant-initiated refunds, splits or reconciliation. That gap is Morva.

## What Morva does

| Layer | What it adds |
| --- | --- |
| **Pay** | Three ways to pay: wallet, signed intent (including passkeys) and a one-time deposit address for exchanges. Exact-output quotes, so the merchant gets the exact invoice amount. Buyers can combine funds held on several chains |
| **Commerce** | Orders and receipts. Hold, capture and void through an escrow contract on NEAR. Refund to source, so the buyer gets their original token on their original chain. Revenue splits, webhooks and ledger export |
| **Ops agent** | A per-merchant Shade Agent that applies policies such as "refund everyone if the event is cancelled" (stretch goal) |
| **Privacy + agents** | Confidential mode. Later, payments from AI agents (x402 / MPP) |

Merchant funds settle into the merchant's own NEAR Intents balance, and the merchant can withdraw to any chain. Morva's servers never hold funds.

The first market is **crypto events and ticketing**. Organizers need what generic checkouts skip: refunds on cancellation, holds until check-in, splits with co-hosts and clean records.

## How a payment flows

```text
Buyer opens link ─► Morva API creates order ─► 1Click EXACT_OUTPUT quote
   │                                              (recipient: merchant or escrow,
   │                                               refundTo, appFees)
   ├─ wallet / signed intent ──┐
   └─ deposit address + QR ────┴─► solvers fill ─► escrow (held) or merchant balance
                                                    │
                     worker polls 1Click status ◄───┘─► webhook + receipt
                     late / short / failed ───────────► refund to source
```

## Repository

```text
apps/web            Next.js: landing page; /pay/[id] and /dashboard during the hackathon
apps/api            Node + Hono API (planned)
apps/api/worker     pg-boss jobs: status polling, refunds, payouts (planned)
packages/domain     order model and state machine (planned)
packages/intents    NEAR Intents 1Click client (planned)
packages/database   Postgres schema (planned)
packages/config     shared config (planned)
contracts/escrow    Rust escrow contract on NEAR (planned)
agents/ops-agent    Shade Agent (planned, stretch)
tests/e2e           acceptance tests for failure cases (planned)
scripts/            Gate 1 payment spike (throwaway research)
docs/               PRD, execution plan, spike findings
```

Each planned folder has a README covering its purpose and the PRD section it implements.

## Getting started

```sh
npm ci
npm run dev              # landing page at http://localhost:3000
npm run build
npm run typecheck

cp .env.example .env     # for the spike only
npm run spike:payments -- --test=1   # dry 1Click quote, moves no funds
npm run test:spike
```

## Docs

- [PRD v2](docs/Morva_PRD_v2.pdf): the source of truth.
- [Execution plan](docs/EXECUTION_PLAN.md): the hackathon schedule, cut list and open decisions.
- [Payment spike](docs/PAYMENT_SPIKE.md): what the 1Click API actually does, and where that differs from the PRD.
- [Brand](brand.md).
