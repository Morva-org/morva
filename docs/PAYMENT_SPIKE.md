# Gate 1: NEAR Intents payment spike

Status: **in progress, 27–31 October 2026.** All five tests run as dry quotes against the live 1Click API. No live (funded) test has run yet. That needs a partner API key and a few dollars in throwaway wallets.

The spike is throwaway research code in [`scripts/payment-spike.mjs`](../scripts/payment-spike.mjs). It checks the PRD's assumptions before the build starts on 1 November. The product client will be written fresh in `packages/intents`.

## Running it

```sh
cp .env.example .env          # fill in ONECLICK_API_KEY and the SPIKE_* values
npm run spike:payments -- --test=1                 # dry quote: no deposit address, no funds
npm run spike:payments -- --test=1 --live          # real deposit address, then polls status
npm run spike:payments -- --test=1 --deposit-address=<addr>   # resume polling
npm run spike:payments -- --test=3 --check         # read Verifier balances for the spike wallet
npm run test:spike                                 # unit tests, no network
```

Options: `--amount=<base units>` (default `1000000`, i.e. 1 USDC or USDT). `--from=<chain>` sets the source chain for test 2 (default `base`).

Without `--live` every quote is `dry: true`. A dry quote does not return a deposit address, so it cannot move funds. With `--live`, the script never sends funds itself. You send the origin-chain deposit, and only tests 2 and 4 sign intents, using the throwaway `SPIKE_EVM_PRIVATE_KEY`.

For test 4 live, set `SPIKE_MERCHANT_INTENTS_ACCOUNT` to the 0x address of `SPIKE_EVM_PRIVATE_KEY`, so the "merchant" can sign the refund with erc191.

## Tests

| # | Question | How | Status (27 Oct) |
| --- | --- | --- | --- |
| 1 | Deposit path: USDT on Tron in, exact USDC out to the merchant's Intents balance; poll to a terminal status | `EXACT_OUTPUT`, `depositType ORIGIN_CHAIN`, `recipientType INTENTS` | Dry quote OK. Live pending |
| 2 | Signed-intent path with erc191 | `depositType INTENTS` → `generate-intent` → sign → `submit-intent` → poll | Dry quote OK. Signature encoding unit-tested. Live pending |
| 3 | One 0x address funded from Arbitrum and Base lands in one Intents account | Same-asset quote per chain with `recipientType INTENTS`, then `mt_batch_balance_of` on `intents.near` | Dry quotes OK. Balance read works (zeros). Live pending |
| 4 | Refund to source: Intents USDC → exact USDT on Tron | `EXACT_OUTPUT`, `depositType INTENTS`, `recipientType DESTINATION_CHAIN` | Dry quote OK. Live pending |
| 5 | Escrow: what a NEAR contract receives from 1Click; can a contract deposit into `intents.near` for another account | Dry quote to a NEAR account with `customRecipientMsg`; docs review | Blocked, see findings 7–9 |

### Dry-run evidence (27 October 2026, no API key, so +25 bps)

| Test | Request | Result |
| --- | --- | --- |
| 1 | 1.00 USDC out | Rejected: `Amount is too low for bridge, try at least 1212087` (≈1.21 USDT minimum from Tron) |
| 1 | 2.00 USDC out | `amountIn` 2.023067 USDT, `minAmountIn` 2.002836, `timeEstimate` 80 s, `refundFee` 0.213691 USDT |
| 1 | 25.00 USDC out | `amountIn` 25.288295 USDT, `minAmountIn` 25.035412 |
| 2 | 2.00 USDC (Base USDC in Intents → NEAR USDC in Intents) | `amountIn` 2.020118, `minAmountIn` 1.999916, `timeEstimate` 10 s |
| 3 | 2.00 USDC, Arbitrum and Base, same asset into own Intents account | `amountIn` = `amountOut` = 2.000000, `withdrawFee` 0 |
| 4 | 1.00 USDT out on Tron | `amountIn` 1.224516 USDC, `withdrawFee` 0.213691 USDT, `timeEstimate` 65 s |
| 5 | Tron USDT → NEAR USDC delivered to a NEAR account (`DESTINATION_CHAIN`), $5 | Rejected: `Temporary swap limits: minimum swap amount is $100` |
| 5 | Same, $150, with `customRecipientMsg` | Rejected: `Internal server error` (400) |

Every quote returned an ed25519 `signature` from 1Click. The docs say to store it with the quote for disputes.

## Findings vs PRD

Sources: the [1Click OpenAPI spec](https://1click.chaindefuser.com/docs/v0/openapi.yaml) (fetched 27 Oct), the [docs](https://docs.near-intents.org), and the dry runs above.

1. **The fee split is worse for Morva than the PRD implies.** The PRD's 25 bps figure is correct for unauthenticated quotes. With an API key, `appFees` is split 50/50 with 1Click, and 1Click's half has a 20 bps minimum (1 bp for USDC/USDT/DAI pairs and same-asset routes). The PRD's "0.5–1% via appFees" means Morva keeps 0.25–0.5%. ([fee config](https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config.md))
2. **The confidential setting is not a boolean flag.** The quote field is `confidentiality: public | basic | advanced`. Signed-intent payments from confidential balances use `depositType CONFIDENTIAL_INTENTS`, and there is no RPC path for them.
3. **Unified balance needs more than "one signed intent".** Arbitrum USDC and Base USDC are different tokens inside NEAR Intents (`nep141:arb-0xaf88…` and `nep141:base-0x8335…`), and a 1Click quote takes exactly one `originAsset`. Paying $10 from $4 on Arbitrum plus $6 on Base through 1Click therefore needs two quotes and two signatures. A single signature would need one of these instead, each to be tested:
   - (a) a hand-built `token_diff` intent sent straight to the Verifier, bypassing 1Click;
   - (b) a first step that swaps the legs into one asset;
   - (c) multiple 1Click intents signed as one batch, if the Verifier accepts a combined payload.
4. **Gather legs look cheap.** Same-asset deposits into the buyer's own Intents account quoted with no visible fee or output loss (`amountIn` = `amountOut`). The docs say 1 bp with an API key.
5. **Short payments are refunded by 1Click, not held for top-up.** With `EXACT_OUTPUT`, a deposit below `minAmountIn` is refunded at the deadline, and a deposit above `amountIn` completes with the excess refunded. PRD §9.7's "one-tap top-up on the same order" can't top up the existing quote. It would need a new quote and deposit address, with the first deposit refunded separately. The `FLEX_INPUT` swap type, which the PRD doesn't mention, accepts a range and may be a better fit for "short within tolerance".
6. **Refund to source has a real floor on some chains.** Withdrawing to Tron cost 0.213691 USDT on a 1 USDT refund (21%). A failed swap refunded to Tron carries the same `refundFee`. The bridge also has minimums: about 1.21 USDT from Tron. The PRD's 100% refund-to-source target needs a policy for refunds smaller than the withdrawal fee, and a decision on who pays the fee.
7. **Delivering to the escrow contract is blocked for small orders.** A quote that delivers USDC to a NEAR account with `recipientType DESTINATION_CHAIN` (an `ft_transfer` to the contract) is currently rejected below $100 ("Temporary swap limits"). Ticket-sized orders can't reach an escrow contract that way today. The alternative is `recipientType INTENTS` with the escrow contract as the recipient, which had no minimum. The escrow would then own a Verifier balance and release it by calling `intents.near` itself, instead of receiving tokens through `ft_on_transfer` as PRD §12 describes. That changes the contract design.
8. **There is no order reference on delivery yet.** `customRecipientMsg` (marked "HIGHLY EXPERIMENTAL"; funds are lost if the receiver doesn't implement `ft_on_transfer`) returned an internal server error. Until that changes, the escrow can't learn the order ID from the 1Click delivery. Each order already has its own quote and deposit address, so matching should key on that. Morva's backend then tells the contract which order a credit belongs to, or each order gets its own sub-account or balance.
9. **Contract deposits for another account are documented.** `ft_transfer_call` to `intents.near` with `msg` set to an account ID assigns the deposit to that account ([deposits](https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/deposits.md)). This answers PRD open question 8 on paper. It still needs a run from a deployed contract.
10. **Address mapping is documented.** ECDSA wallets map to an "Implicit Eth" account equal to the 0x address ([account abstraction](https://docs.near-intents.org/integration/verifier-contract/account-abstraction.md)). Use it lowercase: the RPC read and `signer_id` both accepted the lowercase form. Live funding from two chains is still needed to close PRD question 9.
11. **Status has more states than the PRD lists.** `/v0/status` returns `KNOWN_DEPOSIT_TX`, `PENDING_DEPOSIT`, `INCOMPLETE_DEPOSIT`, `PROCESSING`, `SUCCESS`, `REFUNDED` and `FAILED`. `INCOMPLETE_DEPOSIT` is the natural trigger for `underpaid`. `POST /v0/deposit/submit` can speed up detection when the buyer's wallet gives us the tx hash.
12. **erc191 has two encoding details.** The signature must be `secp256k1:` + base58(r‖s‖v), with `v` normalized from 27/28 to 0/1. `signer_id` is the 0x address. Both are covered by unit tests.

### Merchant accounts: passkeys (2 November 2026)

Evidence: `npm run spike:passkey -- --oneclick`. The script emulates a platform passkey and runs real signed payloads through `simulate_intents` on `intents.near` (contract 0.4.3). That's a free view call: nothing is executed or stored, and no funds move. 10 of 10 checks pass. **Decision: a merchant's passkey-derived implicit account (option A).**

13. **A passkey is a NEAR Intents account on its own.** For P-256 keys the Verifier derives `"0x" + hex(keccak256("p256" ‖ x ‖ y)[12..32])`. We checked this against the source's test vector.
    - `has_public_key` is already true for that pair. There's no registration, no transaction and no per-merchant cost.
    - The ID is fixed by the first passkey and never changes.
    - It's also the merchant's 1Click `recipient`, lowercased (finding 10).
14. **The PRD's named-account option would make Morva custodial.** NEAR access keys can't be P-256, so a `<handle>.morva.near` account needs a non-passkey key to create it and register the passkey. That key would be Morva's, and while it exists Morva could register its own key and move funds. Each account would also cost about 0.0018 NEAR. Rejected.
15. **Passkey signing has strict encoding rules.**
    - Use `standard: "webauthn"`, with `public_key` and `signature` as `p256:` + base58 of the raw 64-byte key or of r‖s.
    - The browser challenge must be sha256 of the exact payload string, and `client_data_json` and `authenticator_data` must be sent exactly as returned.
    - The origin isn't checked, and the user-verified flag isn't enforced on-chain. Morva requires `userVerification: "required"` and ES256 in the browser, and sets the relying party ID to Morva's own domain.
16. **Signatures must be low-S.** Authenticators return either valid S value. The Verifier rejected about half of the raw signatures and all of the low-S ones. The client normalises S to n − S before submitting.
17. **Nonces embed a rotating salt.** The 32-byte nonce is: magic `5628f6c6`, version `00`, the contract's `current_salt` (4 bytes, rotates), the deadline as u64 nanoseconds little-endian, then 15 random bytes. Fetch the salt for each intent.
18. **Money moves through 1Click; key changes need a relayer.**
    - **Through 1Click:** `generate-intent` with `standard: "webauthn"` returns a payload the passkey can sign (checked with a real quote, nothing submitted). Withdrawals and payments are quote, generate-intent, passkey signature, then `submit-intent`.
    - **Through a relayer:** adding or removing a passkey (`add_public_key` / `remove_public_key`) isn't a swap, so 1Click can't submit it. A minimal Morva relayer submits those signed intents and pays NEAR gas. Its key can't move merchant funds.
19. **Backup devices work and can revoke a lost original.** A backup passkey added by signed intent has full control and can remove the first passkey (`public_key_removed`). "You can't remove your last device" is a Morva rule.
20. **There is no testnet.** `intents.testnet` and `defuse.testnet` have no contract, and 1Click is mainnet-only.
    - **Signing paths:** tested free with `simulate_intents` on mainnet.
    - **Full flows:** run on mainnet with a dedicated test merchant, capped by `MAX_TEST_SPEND_USD`.
    - **CI:** uses a mocked Verifier.
21. **Non-custodial means no automatic refunds or payouts from a merchant balance.** Only the merchant's passkey can move it.
    - **Test-payment refund:** one passkey-confirmed tap.
    - **"Send automatically to my wallet":** settles each payment straight to the merchant's wallet at checkout (`recipientType: DESTINATION_CHAIN`). Refunds after payment then aren't possible from Morva. Holds use the escrow contract for every merchant.

## Exit criteria

Gate 1 passes when:

- tests 1 and 4 have each completed once live, with the deposit tx, status history and final amounts recorded here;
- test 2 has completed once live;
- test 3 shows both deposits in one account;
- findings 3, 7 and 8 each have a chosen design (see the open decisions in [EXECUTION_PLAN.md](EXECUTION_PLAN.md)).

No contract, relayer or product code is part of the spike.
