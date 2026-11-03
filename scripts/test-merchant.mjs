// The dedicated test merchant for mainnet runs (there is no NEAR Intents testnet).
//
// It is a software P-256 key that signs exactly as a passkey does (scripts/passkey-account-spike.mjs),
// so scripts can act as a merchant: receive test payments, refund them, withdraw. The key lives
// only in your local .env, never on a server. Fund it with no more than MAX_TEST_SPEND_USD.
//
//   node scripts/test-merchant.mjs new    prints a fresh key to paste into .env
//   node scripts/test-merchant.mjs show   prints the test merchant's NEAR Intents account
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { pathToFileURL } from "node:url";
import { keccak256 } from "viem";
import { base58 } from "./payment-spike.mjs";

export function testMerchantFromEnv(env = process.env) {
  const pkcs8 = env.TEST_MERCHANT_P256_KEY;
  if (!pkcs8) throw new Error("Set TEST_MERCHANT_P256_KEY in .env (run: node scripts/test-merchant.mjs new)");
  const privateKey = createPrivateKey({ key: Buffer.from(pkcs8, "base64"), format: "der", type: "pkcs8" });
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  const accountId = `0x${keccak256(Buffer.concat([Buffer.from("p256"), raw])).slice(26)}`;
  return { privateKey, raw, publicKey: `p256:${base58(raw)}`, accountId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile();
  } catch {}
  const command = process.argv[2];
  if (command === "new") {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    console.log("Add this line to .env (never commit it):\n");
    console.log(`TEST_MERCHANT_P256_KEY=${pkcs8}\n`);
    console.log("Then run: node scripts/test-merchant.mjs show");
  } else if (command === "show") {
    const m = testMerchantFromEnv();
    console.log(`Test merchant NEAR Intents account: ${m.accountId}\nPublic key: ${m.publicKey}`);
  } else {
    console.log("Usage: node scripts/test-merchant.mjs new|show");
    process.exitCode = 1;
  }
}
