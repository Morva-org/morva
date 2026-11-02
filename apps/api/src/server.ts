import { serve } from "@hono/node-server";
import { connectPostgres, migrate } from "@morva/database";
import { createApp } from "./app.ts";
import { configFromEnv } from "./config.ts";
import { consoleMailer } from "./mailer.ts";

try {
  process.loadEnvFile("../../.env");
} catch {}

const config = configFromEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL (see .env.example)");
const db = await connectPostgres(url);
await migrate(db);

const port = Number(process.env.API_PORT || 8787);
serve({ fetch: createApp({ db, config, mailer: consoleMailer }).fetch, port });
console.log(`Morva API on http://localhost:${port} (rp ${config.rpId}, origin ${config.webOrigin})`);
