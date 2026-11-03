// Dashboard: the merchant's live NEAR Intents balance, their passkeys (devices), and payout
// changes confirmed with a passkey. Orders, holds, refunds and payouts arrive with the order
// model; the web app shows labelled sample data for those until then.
import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import {
  consumeChallenge,
  createChallenge,
  findPasskeyByCredentialId,
  listPasskeys,
  recordAudit,
  recordPasskeyUse,
  updateMerchant,
  type Db,
  type Merchant,
} from "@morva/database";
import { checkMoneyAction, validatePayoutAddress } from "@morva/domain";
import { createTokenCatalog, getIntentsBalances, PRICE_SCALE, type OneClickClient } from "@morva/intents";
import type { Config } from "./config.ts";
import type { LIMITS } from "./rate-limit.ts";

type Env = { Variables: { merchant: Merchant; ip: string } };
type Limiter = (c: Context<Env>, name: keyof typeof LIMITS, key: string) => Promise<Response | null>;

const CHALLENGE_TTL_MS = 5 * 60_000;

export type BalanceReader = (accountId: string) => Promise<Map<string, bigint>>;

export interface DashboardDeps {
  db: Db;
  config: Config;
  limit: Limiter;
  publicMerchant: (m: Merchant) => Record<string, unknown>;
  requireMerchant: (c: Context<Env>, next: () => Promise<void>) => Promise<Response | void>;
  oneclick: OneClickClient | null;
  readBalances: BalanceReader;
}

export interface BalanceLine {
  asset_id: string;
  symbol: string | null;
  chain: string | null;
  decimals: number | null;
  /** Smallest units, as a string. */
  amount: string;
  /** Estimated USD value from 1Click's price, or null when the token isn't in the catalog. */
  usd: number | null;
}

export function registerDashboard(app: Hono<Env>, d: DashboardDeps) {
  const catalog = d.oneclick ? createTokenCatalog(d.oneclick) : null;

  /** The account's balance, valued in USD where 1Click knows the token. Throws if RPC fails. */
  async function valued(account: string): Promise<{ lines: BalanceLine[]; usdTotal: number }> {
    const raw = await d.readBalances(account);
    const tokens = catalog ? await catalog.all().catch(() => []) : [];
    const lines: BalanceLine[] = [...raw].map(([assetId, amount]) => {
      const t = tokens.find(x => x.assetId === assetId);
      return {
        asset_id: assetId,
        symbol: t?.symbol ?? null,
        chain: t?.blockchain ?? null,
        decimals: t?.decimals ?? null,
        amount: amount.toString(),
        usd: t ? usdValue(amount, t.decimals, t.price) : null,
      };
    });
    lines.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
    return { lines, usdTotal: Math.round(lines.reduce((sum, l) => sum + (l.usd ?? 0), 0) * 100) / 100 };
  }

  const balanceDown = (c: Context<Env>) =>
    c.json({ error: "balance_unavailable", message: "Couldn’t read your balance right now. Try again in a moment." }, 503);

  app.get("/v1/me/balance", d.requireMerchant, async c => {
    const account = c.get("merchant").intents_account_id;
    if (!account) return c.json({ account: null, lines: [], usd_total: 0 });
    try {
      const { lines, usdTotal } = await valued(account);
      return c.json({ account, lines, usd_total: usdTotal });
    } catch {
      return balanceDown(c);
    }
  });

  // --- changing where payouts go: confirmed with a passkey ---------------------------------
  // The passkey signs a challenge bound (by action_hash) to exactly this change, so a stolen
  // session alone can't redirect payouts. Over $100 in the balance, a backup passkey is required.

  type PayoutChange = { mode: "keep_in_balance"; chain: null; address: null } | { mode: "auto_payout"; chain: string; address: string };

  const readChange = async (c: Context<Env>): Promise<{ ok: true; change: PayoutChange; body: Record<string, unknown> } | { ok: false; res: Response }> => {
    const b: Record<string, unknown> = (await c.req.json<Record<string, unknown>>().catch(() => null)) ?? {};
    if (b.mode === "keep_in_balance") return { ok: true, change: { mode: "keep_in_balance", chain: null, address: null }, body: b };
    if (b.mode !== "auto_payout") return { ok: false, res: c.json({ error: "invalid", field: "mode", message: "Choose how you get paid." }, 400) };
    const check = validatePayoutAddress(String(b.chain ?? ""), String(b.address ?? ""));
    if (!check.ok) return { ok: false, res: c.json({ error: "invalid", field: "address", message: check.message }, 400) };
    return { ok: true, change: { mode: "auto_payout", chain: String(b.chain), address: check.address }, body: b };
  };

  const changeHash = (merchantId: string, ch: PayoutChange) =>
    createHash("sha256").update(JSON.stringify(["payout_change", merchantId, ch.mode, ch.chain, ch.address])).digest("base64url");

  app.post("/v1/me/payout/options", d.requireMerchant, async c => {
    const merchant = c.get("merchant");
    const limited = await d.limit(c, "moneyAction", merchant.id);
    if (limited) return limited;
    if (!merchant.intents_account_id) return c.json({ error: "no_passkey", message: "Create your passkey first: it holds your balance." }, 409);
    const read = await readChange(c);
    if (!read.ok) return read.res;

    const passkeys = (await listPasskeys(d.db, merchant.id)).filter(p => p.registered_on_verifier_at);
    let usdTotal: number;
    try {
      usdTotal = (await valued(merchant.intents_account_id)).usdTotal;
    } catch {
      return balanceDown(c);
    }
    const verdict = checkMoneyAction({ type: "payout_change", usdMicro: BigInt(Math.round(usdTotal * 1e6)) }, passkeys.length);
    if (!verdict.allowed) return c.json({ error: verdict.reason, message: verdict.message }, 403);

    const options = await generateAuthenticationOptions({
      rpID: d.config.rpId,
      userVerification: "required",
      allowCredentials: passkeys.map(p => ({ id: p.credential_id, transports: p.transports as never })),
    });
    const challengeId = await createChallenge(d.db, {
      purpose: "action",
      challenge: options.challenge,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      merchantId: merchant.id,
      actionHash: changeHash(merchant.id, read.change),
    });
    return c.json({ challengeId, options });
  });

  app.post("/v1/me/payout", d.requireMerchant, async c => {
    const merchant = c.get("merchant");
    const limited = await d.limit(c, "moneyAction", merchant.id);
    if (limited) return limited;
    const read = await readChange(c);
    if (!read.ok) return read.res;
    const { challengeId, response } = read.body as { challengeId?: string; response?: AuthenticationResponseJSON };
    if (typeof challengeId !== "string" || !response) return c.json({ error: "invalid_request" }, 400);

    const challenge = await consumeChallenge(d.db, challengeId, "action");
    if (!challenge || challenge.merchant_id !== merchant.id) return c.json({ error: "challenge_expired", message: "That took too long. Try again." }, 400);
    if (challenge.action_hash !== changeHash(merchant.id, read.change)) return c.json({ error: "change_mismatch", message: "The change doesn’t match what you confirmed." }, 400);
    const passkey = await findPasskeyByCredentialId(d.db, response.id);
    if (!passkey || passkey.merchant_id !== merchant.id || !passkey.registered_on_verifier_at) return c.json({ error: "passkey_unknown", message: "That passkey isn’t on this account." }, 401);

    let verified = false;
    let counter = passkey.sign_count;
    try {
      const v = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: d.config.webOrigin,
        expectedRPID: d.config.rpId,
        credential: { id: passkey.credential_id, publicKey: new Uint8Array(passkey.public_key), counter: passkey.sign_count, transports: passkey.transports },
        requireUserVerification: true,
      });
      verified = v.verified;
      counter = v.authenticationInfo.newCounter;
    } catch {}
    if (!verified) return c.json({ error: "passkey_rejected", message: "Your passkey wasn’t accepted. Try again." }, 401);

    await recordPasskeyUse(d.db, passkey.id, counter);
    const updated = await updateMerchant(d.db, merchant.id, { payout_mode: read.change.mode, payout_chain: read.change.chain, payout_address: read.change.address });
    await recordAudit(d.db, merchant.id, "payout.changed", { ...read.change, credential_id: passkey.credential_id });
    return c.json({ merchant: d.publicMerchant(updated) });
  });

  app.get("/v1/me/passkeys", d.requireMerchant, async c => {
    const passkeys = await listPasskeys(d.db, c.get("merchant").id);
    return c.json({
      passkeys: passkeys.map(p => ({
        id: p.id,
        device_label: p.device_label,
        backed_up: p.backed_up,
        on_balance: Boolean(p.registered_on_verifier_at),
        created_at: p.created_at,
        last_used_at: p.last_used_at,
      })),
    });
  });
}

/** amount (smallest units) × price (USD per whole token, scaled) → USD, rounded to cents. */
export function usdValue(amount: bigint, decimals: number, price: bigint): number {
  const cents = (amount * price * 100n) / 10n ** BigInt(decimals + PRICE_SCALE);
  return Number(cents) / 100;
}

export const defaultBalanceReader =
  (rpcUrl?: string): BalanceReader =>
  accountId =>
    getIntentsBalances(accountId, { rpcUrl });
