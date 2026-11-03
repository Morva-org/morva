// Guard for scripts that touch mainnet: refuse anything above MAX_TEST_SPEND_USD.
// There is no NEAR Intents testnet (PAYMENT_SPIKE.md finding 20), so live runs use real money.

export function testSpendCap(env = process.env) {
  const cap = Number(env.MAX_TEST_SPEND_USD);
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error("Set MAX_TEST_SPEND_USD in .env (e.g. 5) before any live run. Scripts refuse to spend without a cap.");
  }
  return cap;
}

/** Throws unless `usd` (a number or a decimal string from a quote) is within the cap. */
export function assertTestSpend(usd, what = "this run", env = process.env) {
  const cap = testSpendCap(env);
  const amount = Number(usd);
  if (!Number.isFinite(amount)) throw new Error(`Can't tell how much ${what} would spend; refusing.`);
  if (amount > cap) {
    throw new Error(`${what} would spend $${amount.toFixed(2)}, above MAX_TEST_SPEND_USD ($${cap.toFixed(2)}). Refusing.`);
  }
  return amount;
}
