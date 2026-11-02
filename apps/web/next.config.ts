import type { NextConfig } from "next";

// The API runs as its own service; the web app routes /api/* to it so the session cookie stays
// first-party on one site (SameSite=Lax) and passkeys share one origin.
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:8787";

const config: NextConfig = {
  transpilePackages: ["@morva/intents", "@morva/domain"],
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${API_ORIGIN}/v1/:path*` }];
  },
};

export default config;
