# Worker

Planned: built from 1 November 2026.

## Purpose

Long-running jobs that serverless functions can't run reliably: watching 1Click swaps, handling Bitcoin-length payment windows, retrying, refunding and paying out.

## What it will contain

- A pg-boss job runner on the same Postgres database as the API.
- 1Click status polling (`PENDING_DEPOSIT` → `PROCESSING` → `SUCCESS` | `REFUNDED` | `FAILED`, plus `INCOMPLETE_DEPOSIT`), mapped onto the order state machine in `packages/domain`.
- Automatic handling of late, short and over payments (re-quote, top-up offer or refund to source).
- Refund-to-source and payout jobs, including the cancel-event bulk refund.
- Webhook delivery and retries.
- For the hackathon, the "auto-refund on cancel" policy runs here as a plain job if the Shade Agent in `agents/ops-agent` is cut.

## PRD sections

§9.7 Failure handling, §10 Order lifecycle, §11 System architecture (Worker), §12 Integration rules.
