// Webhook signing secrets at rest: AES-256-GCM. Each ciphertext records the key version that
// sealed it, so WEBHOOK_SECRET_KEY can rotate while older secrets stay readable.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SecretKeyring {
  /** Version used for new secrets. */
  current: number;
  keys: Map<number, Buffer>;
}

/**
 * WEBHOOK_SECRET_KEY: 32 random bytes, base64. WEBHOOK_SECRET_KEY_VERSION: its version (default 1).
 * During a rotation, WEBHOOK_SECRET_KEY_PREVIOUS (+ _VERSION) keeps older secrets readable.
 */
export function keyringFromEnv(env: NodeJS.ProcessEnv = process.env): SecretKeyring | null {
  if (!env.WEBHOOK_SECRET_KEY) return null;
  const parse = (b64: string, name: string) => {
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded`);
    return key;
  };
  const current = Number(env.WEBHOOK_SECRET_KEY_VERSION || 1);
  const keys = new Map([[current, parse(env.WEBHOOK_SECRET_KEY, "WEBHOOK_SECRET_KEY")]]);
  if (env.WEBHOOK_SECRET_KEY_PREVIOUS) {
    keys.set(Number(env.WEBHOOK_SECRET_KEY_PREVIOUS_VERSION || current - 1), parse(env.WEBHOOK_SECRET_KEY_PREVIOUS, "WEBHOOK_SECRET_KEY_PREVIOUS"));
  }
  return { current, keys };
}

/** Output: 12-byte IV | ciphertext | 16-byte tag, plus the key version that sealed it. */
export function sealSecret(keyring: SecretKeyring, plaintext: string): { ciphertext: Buffer; keyVersion: number } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.keys.get(keyring.current)!, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: Buffer.concat([iv, body, cipher.getAuthTag()]), keyVersion: keyring.current };
}

export function openSecret(keyring: SecretKeyring, sealed: Uint8Array, keyVersion: number): string {
  const key = keyring.keys.get(keyVersion);
  if (!key) throw new Error(`No webhook secret key for version ${keyVersion}`);
  const buf = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]).toString("utf8");
}
