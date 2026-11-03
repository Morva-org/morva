# Morva: NEAR Hackathon execution plan

Source of truth: [Morva PRD v2](Morva_PRD_v2.pdf) (23 October 2026). If this plan and the PRD disagree, the PRD wins until this plan is updated.

> Replaced plan: an earlier version targeted settlement on Monad, with Aurora Intents routing, Dynamic wallets and an Envio indexer. All of that is dropped in favour of NEAR Intents.

| | |
| --- | --- |
| Hackathon | NEAR Hackathon, 1–14 November 2026 |
| Judging | 16–18 November 2026 |
| Submission | Public repo + public X demo post, by 14 November |
| Team | One builder |
| Rule | Product features are built during the hackathon only. Before 1 November: research, docs and repo structure |

## 1. What we are building

> Morva lets any business get paid by anyone holding crypto, from any wallet, on any chain, in the currency the business wants.

Morva is the commerce layer on top of NEAR Intents: orders, holds, refunds to source, splits, reconciliation and payouts. Payment routing is done by the 1Click API, and merchants settle into their own NEAR Intents balance.

### Hackathon definition of done

1. A merchant onboards, picks a settlement asset (default USDC in their NEAR Intents balance), and creates a payment link with a URL and QR code.
2. A buyer pays through each of the three paths, always with an `EXACT_OUTPUT` quote, and the merchant receives the exact invoice amount:
   - the deposit address path;
   - the wallet path;
   - the signed-intent path (`depositType INTENTS`).
3. A buyer pays $10 held across two chains in one checkout (the unified balance).
4. Held orders sit in the escrow contract and can be captured or voided.
5. Cancelling an event refunds every attendee to their original token and chain, with no manual steps.
6. Short, over, late and failed payments resolve as PRD §9.7 describes.
7. The merchant dashboard shows orders, holds, refunds and payouts. Webhooks fire, and the ledger exports as CSV.
8. At least one real PartyStack event takes live ticket payments.

## 2. Repository

npm workspaces. Placeholder folders become workspaces when their code starts.

```text
morva/
├── apps/
│   ├── web/            Next.js: landing page now; /pay/[id] checkout and /dashboard in the hackathon
│   └── api/            Node + Hono: orders, quotes, webhooks, ledger
│       └── worker/     pg-boss jobs: 1Click status polling, refunds, payouts
├── packages/
│   ├── domain/         order model and state machine (the PRD's "core")
│   ├── intents/        NEAR Intents 1Click client
│   ├── database/       Postgres schema and repositories
│   └── config/         shared TS, lint and env config
├── contracts/escrow/   Rust (near-sdk): hold, capture, void, splits
├── agents/ops-agent/   Shade Agent (stretch)
├── tests/e2e/          acceptance tests for PRD §9.7 failure cases
├── scripts/            Gate 1 spike (throwaway)
└── docs/               PRD, this plan, spike findings
```

These are deliberate departures from PRD §15:

- **One web app.** `apps/web` replaces `apps/app` and `apps/checkout` for the hackathon. The split into separate subdomains comes after.
- **No pnpm or Turborepo.** npm workspaces are enough for one builder and a handful of packages.
- **SDK, React and widget packages are not created.** They are on the cut list.

## 3. Gate 1: payment spike (27–31 October 2026)

Details and results: [PAYMENT_SPIKE.md](PAYMENT_SPIKE.md).

| Test | Priority |
| --- | --- |
| 1. Tron USDT → exact USDC into the merchant's Intents balance; poll status | **P0** |
| 4. Refund to source: Intents USDC → USDT on Tron | **P0** |
| 2. Signed-intent payment with erc191 | P1 |
| 3. One 0x address funded from Arbitrum and Base lands in one Intents account | P1 |
| 5. Escrow delivery and contract deposits on behalf of the merchant | P1 |

The dry runs already changed three designs. These need a decision before 1 November:

- **Escrow delivery.** Ticket-sized orders can't be delivered to a contract with `DESTINATION_CHAIN` (temporary $100 minimum). The proposal is for the escrow to hold a Verifier balance instead (`recipientType INTENTS`).
- **Order matching.** `customRecipientMsg` is unusable. The proposal is to match orders by quote deposit address in the backend.
- **Unified balance.** One signed intent across chains isn't possible through 1Click, because each quote takes one origin asset. The proposal is to ship one signature per source asset for the hackathon, and test a direct Verifier `token_diff` as the upgrade.

## 4. Build plan (1–14 November 2026)

| Dates | Scope | Milestone |
| --- | --- | --- |
| **1–2 Nov** | Turn the placeholder folders into workspaces. Write the `packages/intents` client (from spike learnings, not spike code). Write the order state machine in `packages/domain` and the database schema and migrations | Unit tests cover every state transition |
| **2–3 Nov** | Hosted checkout at `/pay/[id]`. Deposit address path with QR and a per-chain countdown. Worker polls 1Click status. Required refund address for exchange payers | **Tron USDT in, exact USDC out** |
| **4–6 Nov** | Wallet path and signed-intent path (erc191, passkeys if time allows). Multi-chain planner: sources, dust skipping, shortfall shown up front | **Pay $10 from two chains with one signature** |
| **7–9 Nov** | Escrow contract on testnet, then mainnet with pilot caps: hold, capture, void. Refund to source (full and partial). Cancel-event flow | **Event cancelled, everyone refunded to their original chain** |
| **10–12 Nov** | Merchant dashboard. Signed webhooks. CSV ledger export. PartyStack ticketing integration. Confidential toggle. Live event | **Real ticket sales** |
| **13 Nov** | README, tests, demo video, final demo post | Demo recorded |
| **14 Nov** | Buffer and submission | Public repo + public X demo post submitted |

On the 4–6 November milestone: if finding 3 holds, "one signature" means one signature per source asset (see §3). The demo copy must say exactly what happens.

### Cut list, in order, if behind

1. Full Shade Agent. Ship "auto-refund on cancel" as a backend job in `apps/api/worker`.
2. SDK, React and widget packages. The hosted checkout and payment links are enough for the demo.
3. Passkey (webauthn) signing. The wallet and deposit paths cover buyers.
4. Splits UI. Keep a single split recipient configured in the database.

The cut list never includes: exact-output quotes, refund addresses on every quote, escrow caps, or server-side secrets.

## 5. Order lifecycle

Defined in [`packages/domain`](../packages/domain/README.md), following PRD §10:

`created → awaiting_payment → confirming → held → captured → settled`

Side branches:

- `confirming → settled` when there is no hold;
- `underpaid`, `expired` and `voided` all lead to `refunding`, then `refunded` or `partially_refunded`;
- `failed` when 1Click returns the funds.

The worker maps 1Click statuses onto these states. Only the API and worker write order state; the web app never does.

## 6. Trust and safety rules

- Morva's servers never hold funds. Merchant funds sit in the merchant's own Intents balance or in the escrow contract. Buyer change stays in the buyer's own Intents balance.
- Every quote sets `refundTo`. Exchange payers must give a personal refund address.
- The 1Click API key and webhook secrets stay server-side.
- Payment windows are sized per chain: minutes for fast chains, 45–60 minutes for Bitcoin.
- Disclose the 1Click trust model: assets pass through a trusted swapping agent during execution.
- The escrow has per-order and per-day caps on mainnet until audited.
- Store every 1Click quote with its `signature`.

## 7. Open decisions

From PRD §21, plus the spike findings:

1. Escrow design: hold a Verifier balance or receive via `ft_on_transfer` (spike findings 7–8).
2. Unified balance: what "one signature" means for the demo (finding 3).
3. Default underpayment tolerance (0.5% or $0.50), and whether top-up means re-quoting (finding 5).
4. Refund fee policy: who pays chain withdrawal fees, and the minimum refundable amount (finding 6).
5. Fee level, given the 50/50 `appFees` split (finding 1).
6. Passkey wallet in v1, or deposit path only, for buyers without a wallet.
7. Dispute handling and compliance checks for the pilot.
