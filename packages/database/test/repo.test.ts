import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  connectMemory,
  consumeChallenge,
  countActivePasskeys,
  createChallenge,
  createMerchantWithPasskey,
  createSession,
  deleteSession,
  findPasskeyByCredentialId,
  getSessionMerchant,
  hitRateLimit,
  isHandleTaken,
  listAudit,
  migrate,
  recordPasskeyUse,
  type Db,
} from "../src/index.ts";

let db: Db;
before(async () => {
  db = await connectMemory();
  assert.deepEqual(await migrate(db), ["001_merchants_and_auth.sql", "002_rate_limits_and_secret_keys.sql", "003_onboarding.sql"]);
  assert.deepEqual(await migrate(db), [], "migrations are idempotent");
});
after(() => db.close());

const account = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const passkey = (id: string) => ({ credentialId: id, publicKey: new Uint8Array([1, 2, 3]), publicKeyP256: `p256:${id}`, signCount: 0, transports: ["internal"], backedUp: true });

describe("merchants and passkeys", () => {
  it("creates a merchant with its first passkey, registered on the Verifier, and audits both", async () => {
    const { merchant, passkey: pk } = await createMerchantWithPasskey(db, account(1), passkey("cred-1"));
    assert.equal(merchant.intents_account_id, account(1));
    assert.equal(merchant.payout_mode, "keep_in_balance");
    assert.equal(merchant.onboarding_step, "business");
    assert.ok(pk.registered_on_verifier_at);
    assert.equal(await countActivePasskeys(db, merchant.id), 1);
    assert.deepEqual((await listAudit(db, merchant.id)).map(a => a.type), ["merchant.created", "passkey.added"]);
  });

  it("enforces one account per passkey and the account format", async () => {
    await assert.rejects(createMerchantWithPasskey(db, account(1), passkey("cred-2")), /duplicate|unique/i);
    await assert.rejects(createMerchantWithPasskey(db, "0xNOT-AN-ACCOUNT", passkey("cred-3")), /check/i);
    assert.equal(await findPasskeyByCredentialId(db, "cred-2"), null, "a failed sign-up leaves nothing behind");
  });

  it("checks handles at the database too", async () => {
    const { merchant } = await createMerchantWithPasskey(db, account(4), passkey("cred-4"));
    await db.query("UPDATE merchant SET handle = 'northside' WHERE id = $1", [merchant.id]);
    assert.equal(await isHandleTaken(db, "northside"), true);
    assert.equal(await isHandleTaken(db, "northside", merchant.id), false, "your own handle isn't taken");
    await assert.rejects(db.query("UPDATE merchant SET handle = 'Bad--Handle' WHERE id = $1", [merchant.id]), /check/i);
  });

  it("only moves a passkey's counter forward", async () => {
    const pk = (await findPasskeyByCredentialId(db, "cred-1"))!;
    await recordPasskeyUse(db, pk.id, 5);
    await recordPasskeyUse(db, pk.id, 3);
    assert.equal((await findPasskeyByCredentialId(db, "cred-1"))!.sign_count, 5);
  });

  it("refuses an auto-payout merchant without a payout chain and address", async () => {
    const { merchant } = await createMerchantWithPasskey(db, account(5), passkey("cred-5"));
    await assert.rejects(db.query("UPDATE merchant SET payout_mode = 'auto_payout' WHERE id = $1", [merchant.id]), /check/i);
  });
});

describe("sessions and challenges", () => {
  it("returns the merchant for a live session and nothing after logout or expiry", async () => {
    const pk = (await findPasskeyByCredentialId(db, "cred-1"))!;
    const token = new Uint8Array(32).fill(7);
    await createSession(db, token, pk.merchant_id, new Date(Date.now() + 60_000), "test");
    assert.equal((await getSessionMerchant(db, token))?.id, pk.merchant_id);
    await deleteSession(db, token);
    assert.equal(await getSessionMerchant(db, token), null);

    const old = new Uint8Array(32).fill(8);
    await createSession(db, old, pk.merchant_id, new Date(Date.now() - 1000), "test");
    assert.equal(await getSessionMerchant(db, old), null);
  });

  it("uses each challenge once, for its own purpose, before it expires", async () => {
    const id = await createChallenge(db, { purpose: "login", challenge: "abc", expiresAt: new Date(Date.now() + 60_000) });
    assert.equal(await consumeChallenge(db, id, "register"), null, "wrong purpose");
    assert.equal((await consumeChallenge(db, id, "login"))?.challenge, "abc");
    assert.equal(await consumeChallenge(db, id, "login"), null, "already used");
    const expired = await createChallenge(db, { purpose: "login", challenge: "x", expiresAt: new Date(Date.now() - 1) });
    assert.equal(await consumeChallenge(db, expired, "login"), null);
  });
});

describe("rate limits", () => {
  it("counts hits in a window and starts a new window once it has passed", async () => {
    assert.equal((await hitRateLimit(db, "login:1.2.3.4", 60_000)).count, 1);
    assert.equal((await hitRateLimit(db, "login:1.2.3.4", 60_000)).count, 2);
    assert.equal((await hitRateLimit(db, "login:5.6.7.8", 60_000)).count, 1, "keys are independent");
    await db.query("UPDATE rate_limit SET reset_at = now() - interval '1 second' WHERE key = 'login:1.2.3.4'");
    const fresh = await hitRateLimit(db, "login:1.2.3.4", 60_000);
    assert.equal(fresh.count, 1);
    assert.ok(fresh.resetAt.getTime() > Date.now());
  });
});
