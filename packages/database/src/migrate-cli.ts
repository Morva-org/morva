// Applies pending migrations to DATABASE_URL: npm run migrate --workspace=@morva/database
import { connectPostgres, migrate } from "./db.ts";

try {
  process.loadEnvFile("../../.env");
} catch {}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (see .env.example)");
  process.exit(1);
}
const db = await connectPostgres(url);
try {
  const applied = await migrate(db);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Up to date");
} finally {
  await db.close();
}
