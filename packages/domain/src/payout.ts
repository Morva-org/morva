// Where a merchant can receive USDC directly ("Send automatically to my wallet"), and how to
// check an address for each chain before any money is pointed at it.
import { keccak_256 } from "@noble/hashes/sha3.js";

export type ChainKind = "evm" | "solana" | "near";

export interface PayoutChain {
  /** 1Click's blockchain id. */
  id: string;
  label: string;
  kind: ChainKind;
}

/** USDC chains in the 1Click catalog whose address formats Morva validates. */
export const PAYOUT_CHAINS: PayoutChain[] = [
  { id: "base", label: "Base", kind: "evm" },
  { id: "arb", label: "Arbitrum", kind: "evm" },
  { id: "eth", label: "Ethereum", kind: "evm" },
  { id: "op", label: "Optimism", kind: "evm" },
  { id: "pol", label: "Polygon", kind: "evm" },
  { id: "avax", label: "Avalanche", kind: "evm" },
  { id: "bsc", label: "BNB Chain", kind: "evm" },
  { id: "gnosis", label: "Gnosis", kind: "evm" },
  { id: "sol", label: "Solana", kind: "solana" },
  { id: "near", label: "NEAR", kind: "near" },
];

export const payoutChain = (id: string) => PAYOUT_CHAINS.find(c => c.id === id);

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Length(s: string): number | null {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  let bytes = 0;
  while (n > 0n) {
    n >>= 8n;
    bytes++;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes++;
  }
  return bytes;
}

/** EIP-55: a mixed-case address must match its checksum; all-lowercase or all-uppercase has none. */
function evmChecksumOk(address: string): boolean {
  const hex = address.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true;
  const hash = keccak_256(new TextEncoder().encode(hex.toLowerCase()));
  for (let i = 0; i < 40; i++) {
    const nibble = (hash[i >> 1]! >> (i % 2 === 0 ? 4 : 0)) & 0xf;
    const c = hex[i]!;
    if (/[a-f]/i.test(c) && (nibble >= 8 ? c !== c.toUpperCase() : c !== c.toLowerCase())) return false;
  }
  return true;
}

const NEAR_NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export type AddressCheck = { ok: true; address: string } | { ok: false; message: string };

/** Validates and normalises an address for a payout chain. */
export function validatePayoutAddress(chainId: string, input: string): AddressCheck {
  const chain = payoutChain(chainId);
  if (!chain) return { ok: false, message: "Choose a supported network." };
  const address = input.trim();
  if (!address) return { ok: false, message: "Enter the address to send to." };
  switch (chain.kind) {
    case "evm":
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { ok: false, message: `That isn't a ${chain.label} address. It should start with 0x and have 42 characters.` };
      if (!evmChecksumOk(address)) return { ok: false, message: "That address has a typo: its capital letters don't match. Copy it again from your wallet." };
      return { ok: true, address };
    case "solana":
      if (base58Length(address) !== 32 || address.length < 32 || address.length > 44) return { ok: false, message: "That isn't a Solana address." };
      return { ok: true, address };
    case "near": {
      const a = address.toLowerCase();
      if (/^[0-9a-f]{64}$/.test(a) || /^0x[0-9a-f]{40}$/.test(a)) return { ok: true, address: a };
      if (a.length >= 2 && a.length <= 64 && NEAR_NAMED.test(a)) return { ok: true, address: a };
      return { ok: false, message: "That isn't a NEAR account, like yourname.near." };
    }
  }
}
