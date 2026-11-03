# Domain package

Built so far: merchant handle rules (`src/handle.ts`) and the money-action policy (`src/money-actions.ts`). Withdrawals and payout changes over $100 need a backup passkey first. The order model and state machine below are next.

## Purpose

Shared order model, types and rules, used by the web app, API and worker. This package plays the role of `packages/core` in the PRD. It is pure TypeScript with no I/O.

## What it will contain

- Types for merchants, products and ticket types, payment links, orders, payments, gather legs, refunds, splits and ledger entries.
- Amount handling in integer base units, plus the underpayment tolerance rule.
- The order state machine. Every transition is explicit, and nothing outside this table is allowed:

| State | Meaning |
| --- | --- |
| `created` | Order exists; no quote yet |
| `awaiting_payment` | Quote issued; deposit address active |
| `confirming` | Deposit detected; 1Click swap in progress |
| `held` | Settlement asset sits in escrow |
| `captured` / `settled` | Funds released to the merchant and split recipients |
| `voided` | Hold cancelled before capture |
| `underpaid` | Short payment awaiting top-up or refund |
| `expired` | Late payment awaiting re-quote or refund |
| `refunding` / `refunded` / `partially_refunded` | Refund-to-source intent in flight / complete |
| `failed` | Swap failed; 1Click returned funds to the refund address |

```text
created -> awaiting_payment -> confirming -> held -> captured -> settled
                                          \-> settled                (no hold)
awaiting_payment -> expired   (timeout)    -> refunding  (late payment)
confirming       -> underpaid (short)      -> refunding  (no top-up)
confirming       -> failed    (1Click returns funds)
held             -> voided                 -> refunding
settled          -> refunding -> refunded | partially_refunded
```

## PRD sections

§10 Order lifecycle, §13 Data model, §9.7 Failure handling.
