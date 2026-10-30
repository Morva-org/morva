# Database package

Planned: built from 1 November 2026.

## Purpose

The Postgres schema, migrations and repository functions for the API and worker. Order state changes are written here inside transactions, and the ledger is append-only.

## What it will contain

Tables for the PRD entities:

- `merchant`: NEAR Intents account, settlement asset and chain, payout address, confidential default, policies.
- `product` / `ticket_type`, `payment_link`.
- `order`, `payment` (origin asset, chain and address, deposit address, quote ID and signature, tx hashes).
- `gather_leg`: one row per source chain in a unified-balance payment.
- `refund`, `split`, `ledger_entry` (capture, refund, fee, split).
- `webhook_endpoint` / `webhook_event`.
- pg-boss also uses this database for its job tables.

Saved quotes keep the full 1Click quote response and its `signature`, which the docs say must be kept to resolve disputes.

## PRD sections

§13 Data model, §11 System architecture (Postgres, pg-boss).
