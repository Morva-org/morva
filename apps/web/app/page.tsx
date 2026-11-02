import {
  ArrowRight,
  Check,
  FileText,
  Layers,
  LockKeyhole,
  RotateCcw,
  Split,
  Wallet,
  Webhook,
} from "lucide-react";
import { CheckoutStory } from "./_checkout/CheckoutStory";
import { HeroScroll } from "./_hero/HeroScroll";
import { ProblemGrid } from "./_problems/ProblemGrid";
import { Atlas } from "./_how/Atlas";
import { MorvaMark } from "./MorvaMark";
import { SITE, SITE_URL } from "./site-config";

const REPO = SITE.github;
const icon = { size: 24, strokeWidth: 1.5 } as const;

const problems = [
  { title: "The wrong network", body: "A buyer sends USDC on one chain to an address that expects another." },
  { title: "Payments that arrive short", body: "Fees come out on the way, and the merchant is left chasing cents." },
  { title: "Refunds that bounce", body: "The merchant, the processor and the buyer’s exchange each point at someone else." },
  { title: "USDC but no gas", body: "The money is there, but there’s nothing left to pay the network fee." },
  { title: "Signing fear", body: "A wallet prompt full of hex is where a lot of buyers stop." },
  { title: "Money in five places", body: "$9 here, $12 there. No single wallet has enough to pay." },
];

const steps = [
  { title: "Create a payment link", body: "Set the amount and how you want to be paid. By default that’s USDC in your own NEAR Intents balance." },
  { title: "The buyer pays with what they hold", body: "From a wallet, from several chains at once, or from an exchange with a one-time deposit address." },
  { title: "NEAR Intents routes it", body: "Solvers fill an exact-output quote, so you receive the invoice amount. If a swap fails, the buyer’s funds go back." },
  { title: "Hold, capture or refund", body: "Keep funds in escrow until check-in, capture them, or refund in the buyer’s original token and chain." },
];

const commerce = [
  { Icon: FileText, title: "Orders and receipts", body: "Every payment is an order with a status, a receipt and a reference you can match.", tone: "card-mint" },
  { Icon: LockKeyhole, title: "Hold, capture, void", body: "An escrow contract on NEAR holds funds until you capture them or release them back.", tone: "card-butter" },
  { Icon: RotateCcw, title: "Refund to source", body: "Refunds go back in the token and on the chain the buyer paid from. Full or partial.", tone: "card-peach" },
  { Icon: Split, title: "Revenue splits", body: "Share each sale with co-hosts, venues or artists, settled to each of them.", tone: "card-lilac" },
  { Icon: Webhook, title: "Webhooks and ledger", body: "Signed webhooks for your systems, and a ledger you can export as CSV.", tone: "card-mint" },
  { Icon: Wallet, title: "Withdraw anywhere", body: "Funds settle in your own NEAR Intents balance. Withdraw to the chain and asset you choose.", tone: "card-butter" },
];

const trust = [
  { title: "Morva never holds funds", body: "Payments settle in your own NEAR Intents balance or in the escrow contract. A buyer’s change stays in their own balance." },
  { title: "Exact amounts", body: "Quotes are exact-output: the buyer sees one total with fees included, and you receive the invoice amount." },
  { title: "A refund address on every payment", body: "Every quote names where money goes if it can’t complete. Exchange payers give a personal refund address first." },
  { title: "What you’re trusting", body: "Routing runs on NEAR Intents. During a swap, assets pass through a trusted swapping agent run by the 1Click service. We say so up front." },
  { title: "Caps until audited", body: "The escrow contract runs with per-order and per-day limits on mainnet until it has been audited." },
];

// Structured data for search engines: who Morva is and what this site is. No product or offer
// types, because nothing is for sale yet.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE.name,
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/apple-icon.png`,
      description: SITE.description,
      sameAs: [SITE.github],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: SITE.name,
      description: SITE.tagline,
      publisher: { "@id": `${SITE_URL}/#organization` },
      inLanguage: "en",
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <header className="site-header">
        <div className="container">
          <a href="#top" className="wordmark" aria-label="Morva home">
            <MorvaMark />
            morva
          </a>
          <nav className="site-nav" aria-label="Main">
            <a href="#checkout">Checkout</a>
            <a href="#how-it-works">How it works</a>
            <a href="#events">For events</a>
            <a href="#trust">Trust</a>
          </nav>
          <a href="#checkout" className="btn btn-small">
            Try the checkout
          </a>
        </div>
      </header>

      <main id="top">
        <HeroScroll />

        <section className="section" aria-labelledby="problem-title">
          <div className="container">
            <div className="section-head">
              <h2 id="problem-title" className="section-title">
                People want to pay with crypto. Checkout is where they give up.
              </h2>
              <p className="section-lead">
                The gap between holding crypto and spending it is full of small failures. Each one loses a sale.
              </p>
            </div>
            <ProblemGrid problems={problems} />
          </div>
        </section>

        <section className="section" id="checkout" aria-labelledby="checkout-title">
          <div className="container">
            <CheckoutStory
              head={
                <h2 id="checkout-title" className="section-title">
                  One total, paid from wherever the money is.
                </h2>
              }
              paragraph={
                <p className="story-lead">
                  The buyer connects a wallet and sees everything they can spend, across chains, as one number. Morva
                  plans the moves, the buyer approves them, then signs once to pay.
                </p>
              }
            />
          </div>
        </section>

        <section className="atlas-section" id="how-it-works" aria-labelledby="how-title">
          <Atlas
            steps={steps}
            subline="NEAR Intents and its 1Click API do the routing. Morva turns a route into a payment a business can run on."
          />
        </section>

        <section className="section" aria-labelledby="commerce-title">
          <div className="container">
            <div className="section-head">
              <h2 id="commerce-title" className="section-title">
                Payment received is where Morva starts.
              </h2>
              <p className="section-lead">
                A swap API moves tokens. It has no orders, holds, refunds, splits or records. That’s the part merchants
                actually run their business on.
              </p>
            </div>
            <div className="grid-3">
              {commerce.map(({ Icon, title, body, tone }) => (
                <div className={`card ${tone}`} key={title}>
                  <Icon {...icon} className="card-icon" aria-hidden="true" />
                  <h3 className="card-title">{title}</h3>
                  <p>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="events" aria-labelledby="events-title">
          <div className="container split">
            <div>
              <div className="section-head" style={{ marginBottom: 0 }}>
                <h2 id="events-title" className="section-title">
                  Built first for crypto events.
                </h2>
                <p className="section-lead">
                  Organizers need what generic checkouts skip. Tickets get cancelled, held, shared and audited.
                </p>
              </div>
              <ul className="check-list">
                <li>
                  <Check size={18} strokeWidth={1.5} />
                  <span>
                    <strong>Cancel the event, refund everyone.</strong> Each attendee gets their original token back on
                    their original chain, with no manual steps.
                  </span>
                </li>
                <li>
                  <Check size={18} strokeWidth={1.5} />
                  <span>
                    <strong>Hold until check-in.</strong> Capture the payment at the door, or void it for no-shows.
                  </span>
                </li>
                <li>
                  <Check size={18} strokeWidth={1.5} />
                  <span>
                    <strong>Split with co-hosts.</strong> Each partner’s share settles to them directly.
                  </span>
                </li>
                <li>
                  <Check size={18} strokeWidth={1.5} />
                  <span>
                    <strong>Clean records.</strong> Every order, hold and refund in one exportable ledger.
                  </span>
                </li>
              </ul>
            </div>

            <div className="card card-peach" aria-label="Example: an event cancellation">
              <p className="meta" style={{ color: "var(--ink)" }}>
                Example
              </p>
              <h3 className="card-title" style={{ marginTop: 4 }}>
                Builders’ night is cancelled
              </h3>
              <div className="card" style={{ marginTop: 20, padding: "8px 20px", borderRadius: 20 }}>
                <div className="row-list" style={{ borderTop: 0 }}>
                  <div className="row">
                    <span className="row-label">
                      <span>Ada · 25.00 USDT</span>
                      <span className="meta">Back to Tron</span>
                    </span>
                    <span className="status status-success">
                      <Check size={16} strokeWidth={1.5} /> Refunded
                    </span>
                  </div>
                  <div className="row">
                    <span className="row-label">
                      <span>Kofi · 0.0107 ETH</span>
                      <span className="meta">Back to Base</span>
                    </span>
                    <span className="status status-success">
                      <Check size={16} strokeWidth={1.5} /> Refunded
                    </span>
                  </div>
                  <div className="row">
                    <span className="row-label">
                      <span>Mei · 25.00 USDC</span>
                      <span className="meta">Back to Solana</span>
                    </span>
                    <span className="status status-muted">Processing</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="trust" aria-labelledby="trust-title">
          <div className="container">
            <div className="section-head">
              <h2 id="trust-title" className="section-title">
                Non-custodial, and clear about it.
              </h2>
              <p className="section-lead">What Morva does with your money, and what it never does.</p>
            </div>
            <div className="trust-list">
              {trust.map(t => (
                <div className="trust-item" key={t.title}>
                  <h3 style={{ fontSize: 17 }}>{t.title}</h3>
                  <p className="muted">{t.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="build-title">
          <div className="container">
            <div className="card card-lilac" style={{ display: "grid", gap: 20, padding: 40 }}>
              <Layers {...icon} aria-hidden="true" />
              <h2 id="build-title" className="section-title" style={{ maxWidth: "20ch" }}>
                Morva is being built in the open.
              </h2>
              <p style={{ maxWidth: "40em" }}>
                The code, the plan and what we’ve learned testing NEAR Intents are all public. Follow along, or get in
                touch if you run events and want to take crypto without the support tickets.
              </p>
              <div>
                <a href={REPO} className="btn" target="_blank" rel="noreferrer">
                  View on GitHub <ArrowRight size={18} strokeWidth={1.5} />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <span className="wordmark" style={{ fontSize: 18 }}>
            <MorvaMark size={24} />
            morva
          </span>
          <div className="footer-links">
            <a href="#how-it-works">How it works</a>
            <a href="#trust">Trust</a>
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
          <p className="meta" style={{ width: "100%" }}>
            Built on NEAR Intents. Not yet taking real payments.
          </p>
        </div>
      </footer>
    </>
  );
}
