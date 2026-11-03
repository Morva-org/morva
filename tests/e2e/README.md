# End-to-end tests

Planned: built from 1 November 2026.

## Purpose

Acceptance tests for the full payment and commerce flow across the web app, API, worker and escrow contract. They check that every failure case resolves itself without a support ticket.

## What it will contain

The happy paths:

- Merchant creates a payment link; buyer pays through the deposit path; order reaches `settled` with the exact invoice amount.
- Wallet path and signed-intent path (`depositType: INTENTS`) reach the same result.
- Unified balance: the buyer pays $10 from two chains with one signature, and the change stays in their own balance.
- Hold, then capture: the order goes `held` → `captured` → `settled`, and splits are paid.

The failure cases (PRD §9.7):

| Case | Expected result |
| --- | --- |
| Paid short, within tolerance | Order marked paid |
| Paid short, outside tolerance | Top-up offered on the same order, otherwise auto-refund |
| Paid too much | Order completes; excess refunded |
| Paid after the window | Re-quote; complete if price is within tolerance, otherwise full refund |
| Swap failed | 1Click returns funds to the refund address; order `failed`; buyer notified |
| One leg of a multi-chain gather fails | Other legs stay in the buyer's own balance; buyer can retry |
| Buyer's total across chains is short | Shortfall shown before any approval |
| Refund to source (full and partial) | Buyer receives their original token on their original chain |
| Event cancelled | Every held order voided and refunded to source |

Tests that need real liquidity run against mocked 1Click responses in CI. A small set runs against live mainnet with capped amounts before the demo.

## PRD sections

§9 User flows, §9.7 Failure handling, §10 Order lifecycle, §18 Success metrics.
