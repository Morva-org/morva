# Ops agent

Planned: built from 1 November 2026. **Stretch goal for the hackathon.**

## Purpose

A per-merchant agent that enforces the merchant's policies automatically: refund on cancellation, capture on check-in, sweeping balances to treasury, and reconciling payments against orders. It runs as a NEAR Shade Agent in a trusted execution environment (TEE). It can only do what the merchant's on-chain policy allows.

## What it will contain

- A Shade Agent bound to an agent contract that holds the merchant's policy.
- First policy for the hackathon: auto-refund every order when an event is cancelled.
- Later policies: capture on check-in, sweeps, reconciliation and anomaly flags.
- Chain Signatures, so the agent can sign refund transactions on the buyer's original chain.

## Hackathon cut line

If the build falls behind, the full Shade Agent is cut. In that case "auto-refund on cancel" ships as a plain job in [`apps/api/worker`](../../apps/api/worker/README.md), and this folder stays a plan.

## PRD sections

§7 Layer 3 (Ops agent), §12 (Shade Agents, Chain Signatures), §16 (Agent guardrails).
