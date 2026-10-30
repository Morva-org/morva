# Escrow contract

Planned: built from 1 November 2026.

## Purpose

The NEAR Intents Verifier has no native way to hold funds, so Morva provides one. Held orders settle into this contract instead of directly into the merchant's balance. Only the contract's rules can release the funds: Morva's servers never hold them.

## What it will contain

- A Rust contract written with `near-sdk`, deployed to NEAR testnet first.
- `hold`: receives settled USDC for an order (via `ft_on_transfer`) and records it against the order reference.
- `capture`: deposits into the merchant's NEAR Intents balance with `ft_transfer_call` to `intents.near`, naming the merchant in `msg`. Split recipients are paid in the same step.
- `void`: cancels a hold and routes the funds into refund to source.
- Per-order and per-day caps while in pilot. The contract needs an audit before volume grows beyond pilot limits.

## Questions the spike must answer first

These come from PRD §21 and are covered by spike test 5 in [docs/PAYMENT_SPIKE.md](../../docs/PAYMENT_SPIKE.md):

1. When 1Click delivers USDC to this contract, does it arrive with an order reference? 1Click has an experimental `customRecipientMsg` quote field that may make this possible. Otherwise it is a plain transfer.
2. Can this contract deposit into `intents.near` for the merchant by naming them in `msg`?

## PRD sections

§7 Layer 2 (Commerce), §9.5 Hold and capture, §12 (Escrow contract), §16 Security and trust.
