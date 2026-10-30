// Money is bigint in the asset's smallest unit. Decimal strings from the API are parsed here and
// nowhere else, truncating toward zero so a value is never overstated.

const DECIMAL = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/** Parses a non-negative decimal string (exponent form allowed) into units of 10^-scale. */
export function parseDecimal(value: string, scale: number): bigint {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new RangeError(`Not a non-negative decimal: ${value}`);
  const [, whole = "", fraction = "", exponent = "0"] = match;
  const digits = BigInt(whole + fraction);
  const shift = scale - fraction.length + Number(exponent);
  return shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift);
}

/** The catalog returns prices as JSON numbers; convert once, at the boundary. */
export function priceFromNumber(price: number): bigint {
  if (!Number.isFinite(price) || price < 0) throw new RangeError(`Invalid price: ${price}`);
  return parseDecimal(String(price), PRICE_SCALE);
}

/** Token prices are USD per whole token, scaled by 10^PRICE_SCALE so tiny prices keep precision. */
export const PRICE_SCALE = 18;
/** USD values are micro-dollars (10^-6), the same scale as USDC. */
export const USD_SCALE = 6;

export function usdValue(amount: bigint, decimals: number, price: bigint): bigint {
  return (amount * price) / 10n ** BigInt(decimals + PRICE_SCALE - USD_SCALE);
}

export function formatUnits(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
