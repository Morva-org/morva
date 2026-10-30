# @morva/intents

The one place in the codebase that talks to the NEAR Intents 1Click API and the Verifier contract (`intents.near`). PRD §7 (Pay, unified balance), §11 and §12.

**Server-only.** The client carries the partner key (`ONECLICK_API_KEY`), and `createOneClickClient` refuses a key when it detects a browser.

## What it exports

| Export | What it does |
| --- | --- |
| `createOneClickClient({ apiKey, fetch?, baseUrl?, timeoutMs? })` | `getTokens`, `quote`, `getStatus`, `submitDepositTx`, `generateIntent`, `submitIntent` |
| `createTokenCatalog(client, { ttlMs? })` | Cached catalog: `find(chain, symbol)`, `byContract(chain, address \| null)`, `byAssetId`. Serves a stale copy if a refresh fails |
| `getIntentsBalances(accountId, { tokenIds?, rpcUrl? })` | Verifier balances over NEAR RPC (`mt_tokens_for_owner`, `mt_batch_balance_of`) |
| `evmIntentsAccount(address)` | An EVM wallet's NEAR Intents account: its lowercase 0x address |
| `toVerifierErc191Signature(hex)` | Wallet signature to `secp256k1:` + base58, with `v` normalized to 0/1 |
| `parseDecimal`, `usdValue`, `formatUnits` | Money helpers. Amounts are bigint smallest units; USD values are micro-dollars; prices are scaled by 10^18 |
| `IntentsError` | `kind`: `http`, `network`, `timeout`, `invalid_response`, `rpc`, `invalid_request`. Has `status`, `path`, `body`, and `minAmount` when 1Click rejects an amount as too small |

`quote()` requires `dry` explicitly, because a real quote creates a deposit address. It also requires `refundTo`, validates amounts and fees locally, and lowercases 0x addresses used as NEAR Intents accounts. 1Click rejects the checksummed form (see below).

Account balances come from the Verifier, not from `GET /v0/account/balances`, because that endpoint needs a per-user session token from `/v0/auth/authenticate`.

## Behaviour measured against the live API (27 October 2026, dry quotes, no API key)

| What | Result |
| --- | --- |
| Checksummed 0x as an `INTENTS` recipient | Rejected ("recipient is not valid"). Lowercase works. A checksummed origin-chain `refundTo` is fine |
| Gather minimums | Base USDC: 0.15. Ethereum USDC: 0.300001. Arbitrum, Optimism and Polygon accepted 0.10 |
| Gather time estimates (`timeEstimate`) | Arbitrum 25 s; Base, Optimism and Polygon 35 s; Ethereum 45 s |
| Gather output | USDC legs within 0.02% of input. Base ETH to USDC: about 0.25% lower |
| Same-asset payment from an Intents balance, EXACT_OUTPUT 3.50 | `amountIn` = 3.50 / (1 − slippage): 3.535354 at 100 bps, 3.503504 at 10 bps, 3.50 at 0 bps. `minAmountIn` is 3.50 in every case |

## Tests

```sh
npm test --workspace=@morva/intents
npm run typecheck --workspace=@morva/intents
```

Every function is tested against mocked HTTP, including error shapes. Node runs the TypeScript directly (type stripping), so the package has no build step.
