# API service

Planned: built from 1 November 2026.

## Purpose

The merchant-facing backend. It owns orders and their state, talks to the NEAR Intents 1Click API, and is the only component allowed to move an order between states. It never holds funds: buyer and merchant balances live in NEAR Intents or in the escrow contract.

## What it will contain

- Node + Hono HTTP service backed by Postgres.
- Merchant auth and API keys.
- The `/v1` endpoints: orders, quotes, multi-chain payment plans, capture, void, refunds, payment links, and ledger export (JSON and CSV).
- Signed merchant webhooks (`order.created`, `order.paid`, `order.held`, `order.captured`, `order.refunded`, `order.failed`) with HMAC per endpoint and exponential-backoff retries.
- The 1Click partner key, kept server-side only.
- [`worker/`](worker/README.md): background jobs.

## PRD sections

§11 System architecture, §13 Data model, §14 API surface, §16 Security and trust.
