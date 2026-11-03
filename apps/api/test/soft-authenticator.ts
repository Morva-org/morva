// A software passkey for tests: produces real WebAuthn registration and authentication
// responses (CBOR attestation, COSE key, ECDSA P-256), verified by the API like any device's.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

const sha256 = (d: string | Uint8Array) => createHash("sha256").update(d).digest();
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

// Minimal CBOR encoder: unsigned and negative ints, byte and text strings, maps.
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  throw new Error("CBOR length too large for this encoder");
}
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function cbor(v: Cbor): Buffer {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, val]) => [cbor(k), cbor(val)])]);
}

export interface SoftAuthenticatorOptions {
  rpId: string;
  origin: string;
  /** Whether the authenticator reports user verification (Face ID, PIN). */
  userVerified?: boolean;
}

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private privateKey: KeyObject;
  readonly x: Buffer;
  readonly y: Buffer;
  private counter = 0;
  private opts: Required<SoftAuthenticatorOptions>;

  constructor(opts: SoftAuthenticatorOptions) {
    this.opts = { userVerified: true, ...opts };
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: "jwk" });
    this.x = Buffer.from(jwk.x!, "base64url");
    this.y = Buffer.from(jwk.y!, "base64url");
  }

  get id() {
    return b64url(this.credentialId);
  }

  private flags(attested: boolean) {
    // UP | UV? | BE | BS (synced passkey) | AT on registration.
    return 0x01 | (this.opts.userVerified ? 0x04 : 0) | 0x08 | 0x10 | (attested ? 0x40 : 0);
  }

  private clientData(type: string, challenge: string, origin = this.opts.origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** Answers navigator.credentials.create() for the given options. */
  register(options: { challenge: string; rp: { id?: string } }, overrides: { origin?: string; alg?: number } = {}) {
    const coseKey = cbor(
      new Map<Cbor, Cbor>([
        [1, 2],
        [3, overrides.alg ?? -7],
        [-1, 1],
        [-2, this.x],
        [-3, this.y],
      ]),
    );
    const credLen = Buffer.from([this.credentialId.length >> 8, this.credentialId.length & 0xff]);
    const authData = Buffer.concat([
      sha256(options.rp.id ?? this.opts.rpId),
      Buffer.from([this.flags(true)]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.alloc(16),
      credLen,
      this.credentialId,
      coseKey,
    ]);
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64url(this.clientData("webauthn.create", options.challenge, overrides.origin)),
        attestationObject: b64url(attestationObject),
        transports: ["internal" as const],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform" as const,
    };
  }

  /** Answers navigator.credentials.get() for the given challenge. */
  authenticate(challenge: string, overrides: { origin?: string } = {}) {
    this.counter++;
    const authData = Buffer.concat([
      sha256(this.opts.rpId),
      Buffer.from([this.flags(false)]),
      Buffer.from([0, 0, (this.counter >> 8) & 0xff, this.counter & 0xff]),
    ]);
    const clientDataJSON = this.clientData("webauthn.get", challenge, overrides.origin);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform" as const,
    };
  }
}
