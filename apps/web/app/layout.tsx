import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "./site.css";

const description =
  "Morva lets any business get paid by anyone holding crypto, from any wallet, on any chain, in the currency the business wants. Built on NEAR Intents.";
const socialImage = { url: "/section/og.png", width: 1200, height: 630, alt: "A Morva pass receiving one payment from three chains" };

export const metadata: Metadata = {
  // Set NEXT_PUBLIC_SITE_URL to the production domain so social images get absolute URLs.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Morva — Every wallet. Every chain. One way to get paid.",
  description,
  openGraph: { title: "Morva", description, images: [socialImage] },
  twitter: { card: "summary_large_image", images: [socialImage] },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
