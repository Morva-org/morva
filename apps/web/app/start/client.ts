// Browser helpers for onboarding: the API (same origin, via /api), passkeys, and QR codes.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { keyIntentPayload, payloadChallenge, webauthnSignedIntent } from "@morva/intents";
import QRCode from "qrcode";

export interface Merchant {
  id: string;
  handle: string | null;
  business_name: string | null;
  logo_url: string | null;
  country: string | null;
  contact_email: string | null;
  contact_email_verified: boolean;
  intents_account_id: string | null;
  has_passkey: boolean;
  google_linked: boolean;
  payout_mode: "keep_in_balance" | "auto_payout";
  payout_chain: string | null;
  payout_address: string | null;
  refund_policy_default: "full_to_source" | "none";
  hold_by_default: boolean;
  confidential_default: boolean;
  sales_channels: string[];
  terms_accepted: boolean;
  onboarding_step: string;
  live: boolean;
}

export class ApiError extends Error {
  status: number;
  code: string;
  field?: string;
  constructor(status: number, body: { error?: string; message?: string; field?: string }) {
    super(body.message ?? "Something went wrong. Try again.");
    this.status = status;
    this.code = body.error ?? "error";
    this.field = body.field;
  }
}

export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const raw = body instanceof Blob;
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: raw ? { "content-type": body.type } : body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

// --- email and Google sign-in --------------------------------------------------------------

export const sendLoginCode = (email: string) => api("POST", "/auth/email/start", { email });

export async function verifyLoginCode(email: string, code: string): Promise<Merchant> {
  return (await api<{ merchant: Merchant }>("POST", "/auth/email/verify", { email, code })).merchant;
}

export const GOOGLE_START = "/api/v1/auth/google/start";

/** Plain words for the `?error=` the Google callback sends back to /start. */
export function googleError(code: string | null): string | null {
  if (!code) return null;
  if (code === "google_expired") return "Google sign-in took too long. Try again.";
  if (code === "google_unavailable") return "Google sign-in isn’t available right now. Use your email instead.";
  return "Google couldn’t sign you in. Try again, or use your email.";
}

// --- passkeys -------------------------------------------------------------------------------

/** Plain words for the browser's passkey errors. */
export function passkeyMessage(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError") return "The passkey prompt was closed. Try again when you're ready.";
  if (name === "InvalidStateError") return "This device already has a Morva passkey. Log in instead.";
  if (error instanceof ApiError) return error.message;
  return "Your device couldn't create a passkey. Try again, or use another device.";
}

/**
 * Creates a passkey. Signed in (email or Google), it becomes the passkey that holds this
 * merchant's balance; signed out, it creates a new merchant.
 */
export async function createPasskey(): Promise<Merchant> {
  const { challengeId, options } = await api<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("POST", "/auth/register/options");
  const response = await startRegistration({ optionsJSON: options });
  return (await api<{ merchant: Merchant }>("POST", "/auth/register/verify", { challengeId, response, deviceLabel: deviceLabel() })).merchant;
}

export async function logInWithPasskey(): Promise<Merchant> {
  const { challengeId, options } = await api<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("POST", "/auth/login/options");
  const response = await startAuthentication({ optionsJSON: options });
  return (await api<{ merchant: Merchant }>("POST", "/auth/login/verify", { challengeId, response })).merchant;
}

interface Signer {
  credential_id: string;
  public_key_p256: string;
  transports: string[];
}

/** Has one of the merchant's passkeys sign `payload` exactly: the challenge is sha256(payload). */
export async function signWithPasskey(payload: string, signers: Signer[], rpId: string) {
  const assertion = await startAuthentication({
    optionsJSON: {
      challenge: await payloadChallenge(payload),
      rpId,
      userVerification: "required",
      allowCredentials: signers.map(s => ({ id: s.credential_id, type: "public-key" as const, transports: s.transports as never })),
    },
  });
  const signer = signers.find(s => s.credential_id === assertion.id);
  if (!signer) throw new Error("That passkey isn't on this account.");
  return webauthnSignedIntent({ payload, publicKeyP256: signer.public_key_p256, assertion: assertion.response });
}

/** Backup device: create a second passkey, then have the first one authorise it on NEAR Intents. */
export async function addBackupDevice(rpId: string): Promise<void> {
  const { challengeId, options } = await api<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("POST", "/me/passkeys/options");
  const response = await startRegistration({ optionsJSON: options });
  const added = await api<{ passkey: { public_key_p256: string }; signers: Signer[]; intents_account_id: string }>("POST", "/me/passkeys/verify", {
    challengeId,
    response,
    deviceLabel: "Backup device",
  });
  const { salt } = await api<{ salt: string }>("GET", "/intents/salt");
  const payload = keyIntentPayload({ signerId: added.intents_account_id, intent: "add_public_key", publicKey: added.passkey.public_key_p256, salt });
  const signed = await signWithPasskey(payload, added.signers, rpId);
  await api("POST", "/relayer/key-intents", { signed });
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows computer";
  return "This device";
}

// --- QR codes with the Return mark in the centre ---------------------------------------------

const MARK_PATH = "M20 68 V22 L50 54 L80 22 V66 C80 84 66 90 48 90 H30";
const INK = "#16161A";

/** The QR's dark modules, with high error correction so the centre mark doesn't break it. */
function matrix(text: string) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  const size = qr.modules.size;
  return { size, dark: (r: number, c: number) => qr.modules.get(r, c) === 1 };
}

export function qrSvg(text: string): string {
  const { size, dark } = matrix(text);
  const q = 4; // quiet zone
  const n = size + q * 2;
  let rects = "";
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (dark(r, c)) rects += `<rect x="${c + q}" y="${r + q}" width="1" height="1"/>`;
  const box = Math.round(size * 0.24);
  const at = (n - box) / 2;
  const s = box / 100;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="#FFFFFF"/><g fill="${INK}">${rects}</g>` +
    `<rect x="${at}" y="${at}" width="${box}" height="${box}" fill="#FFFFFF"/>` +
    `<g transform="translate(${at} ${at}) scale(${s})" shape-rendering="geometricPrecision">` +
    `<path d="${MARK_PATH}" fill="none" stroke="#0E1726" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="18" cy="90" r="6.5" fill="#1DB36B"/></g></svg>`
  );
}

export async function qrPng(text: string, px = 1024): Promise<Blob> {
  const { size, dark } = matrix(text);
  const q = 4;
  const n = size + q * 2;
  const scale = Math.floor(px / n);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = INK;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (dark(r, c)) ctx.fillRect((c + q) * scale, (r + q) * scale, scale, scale);
  const box = Math.round(size * 0.24) * scale;
  const at = (canvas.width - box) / 2;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(at, at, box, box);
  ctx.save();
  ctx.translate(at, at);
  ctx.scale(box / 100, box / 100);
  ctx.strokeStyle = "#0E1726";
  ctx.lineWidth = 11;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D(MARK_PATH));
  ctx.fillStyle = "#1DB36B";
  ctx.beginPath();
  ctx.arc(18, 90, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"));
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
