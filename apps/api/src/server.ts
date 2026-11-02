import { serve } from "@hono/node-server";
import { connectPostgres, migrate } from "@morva/database";
import { createApp } from "./app.ts";
import { configFromEnv } from "./config.ts";
import { mailerFromEnv } from "./mailer.ts";
import { relayerFromEnv } from "./relayer.ts";
import { createOneClickClient } from "@morva/intents";

try {
  process.loadEnvFile("../../.env");
} catch {}

const config = configFromEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL (see .env.example)");
const db = await connectPostgres(url);
await migrate(db);

const port = Number(process.env.API_PORT || 8787);
const relayer = await relayerFromEnv();
if (!relayer) console.warn("Relayer not configured (RELAYER_ACCOUNT_ID, RELAYER_PRIVATE_KEY): adding a backup device is unavailable.");
const oneclick = createOneClickClient({ apiKey: process.env.ONECLICK_API_KEY || undefined });
const app = createApp({ db, config, mailer: mailerFromEnv(), relayer, oneclick, verifierRpcUrl: process.env.NEAR_RPC_URL || undefined });
serve({ fetch: app.fetch, port });
console.log(`Morva API on http://localhost:${port} (rp ${config.rpId}, origin ${config.webOrigin})`);
