// Wallets return a 65-byte hex signature with v = 27/28. The Verifier expects
// "secp256k1:" + base58(r || s || v) with v = 0/1 (spike finding 12).

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function toVerifierErc191Signature(hex: string): string {
  const clean = hex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{130}$/.test(clean)) throw new RangeError("Expected a 65-byte hex secp256k1 signature");
  const bytes = Uint8Array.from(clean.match(/../g)!, byte => parseInt(byte, 16));
  if (bytes[64]! >= 27) bytes[64]! -= 27;
  if (bytes[64]! > 1) throw new RangeError("Unexpected recovery byte");
  return `secp256k1:${base58(bytes)}`;
}
