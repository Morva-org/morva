// One source for the site's name, address and copy, used by metadata, the sitemap, robots,
// the manifest and structured data.

/** The production origin. Set NEXT_PUBLIC_SITE_URL (e.g. https://morva.example) when deploying. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Only the production deployment should be indexed; previews and local builds stay out of search. */
export const INDEXABLE = Boolean(process.env.NEXT_PUBLIC_SITE_URL) && process.env.VERCEL_ENV !== "preview";

export const SITE = {
  name: "Morva",
  title: "Morva — Every wallet. Every chain. One way to get paid.",
  tagline: "Every wallet. Every chain. One way to get paid.",
  description:
    "Morva lets any business get paid by anyone holding crypto, from any wallet, on any chain, in the currency the business wants. Built on NEAR Intents.",
  github: "https://github.com/Morva-org/morva",
  themeColor: "#FAFAF8",
  socialImage: {
    url: "/section/og.png",
    width: 1200,
    height: 630,
    alt: "Morva: one order paid from three chains, with holds, refunds and splits around it",
  },
};
