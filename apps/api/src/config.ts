export interface Config {
  /** WebAuthn relying party ID: Morva's own domain (e.g. "morva.example"). Passkeys are bound to it. */
  rpId: string;
  rpName: string;
  /** The exact origin the web app is served from; also the only origin allowed to POST. */
  webOrigin: string;
  /** Server secret for HMACs (email codes). Never used for anything that can move funds. */
  sessionSecret: string;
  /** Whether to mark cookies Secure. On by default; only off for plain-http local development. */
  secureCookies: boolean;
  /** Take the client IP from X-Forwarded-For (only behind a trusted proxy). */
  trustProxy: boolean;
  sessionDays: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const need = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`Set ${name} (see .env.example)`);
    return v;
  };
  const secret = need("SESSION_SECRET");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return {
    rpId: need("RP_ID"),
    rpName: env.RP_NAME || "Morva",
    webOrigin: need("WEB_ORIGIN"),
    sessionSecret: secret,
    secureCookies: env.INSECURE_COOKIES !== "1",
    trustProxy: env.TRUST_PROXY === "1",
    sessionDays: Number(env.SESSION_DAYS || 30),
  };
}
