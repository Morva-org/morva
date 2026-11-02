import { connectMemory, migrate, type Db } from "@morva/database";
import { createApp, SESSION_COOKIE, type Deps } from "../src/app.ts";
import type { Config } from "../src/config.ts";
import { SoftAuthenticator } from "./soft-authenticator.ts";

export const config: Config = {
  rpId: "morva.example",
  rpName: "Morva",
  webOrigin: "https://morva.example",
  sessionSecret: "test-secret-test-secret-test-secret-123",
  secureCookies: true,
  trustProxy: true,
  sessionDays: 30,
};

let ip = 0;

export async function setup(extra: Partial<Deps> = {}) {
  const db: Db = await connectMemory();
  await migrate(db);
  const sent: { to: string; code: string }[] = [];
  const app = createApp({ db, config, mailer: { sendVerificationCode: async (to, code) => void sent.push({ to, code }) }, ...extra });

  /** A browser-like client: keeps the session cookie and sends the web app's origin. */
  const client = () => {
    let cookie = "";
    const addr = `10.1.${Math.floor(++ip / 250)}.${ip % 250}`;
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const raw = body instanceof Uint8Array;
      const res = await app.request(path, {
        method,
        headers: {
          ...(raw ? {} : { "content-type": "application/json" }),
          origin: config.webOrigin,
          "x-forwarded-for": addr,
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : raw ? new Blob([new Uint8Array(body)]) : JSON.stringify(body),
      });
      const set = res.headers.get("set-cookie");
      if (set?.startsWith(`${SESSION_COOKIE}=`)) cookie = set.split(";")[0]!;
      const text = await res.text();
      let json: Record<string, any> = {};
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: res.status, body: json, headers: res.headers, text };
    };
    return { call };
  };

  /** Signs up a new merchant with a fresh software passkey. */
  const merchant = async () => {
    const c = client();
    const auth = new SoftAuthenticator({ rpId: config.rpId, origin: config.webOrigin });
    const opts = await c.call("POST", "/v1/auth/register/options");
    const res = await c.call("POST", "/v1/auth/register/verify", { challengeId: opts.body.challengeId, response: auth.register(opts.body.options) });
    return { c, auth, merchant: res.body.merchant as Record<string, any> };
  };

  return { db, app, sent, client, merchant, close: () => db.close() };
}
