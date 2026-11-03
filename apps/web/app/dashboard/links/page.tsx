"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Plus } from "lucide-react";
import { sampleLinks } from "../sample";
import { PageHead, PAY_BASE, SampleNotice, SampleTag, shortDate, usdc, useSession } from "../_ui";

export default function LinksPage() {
  const { m } = useSession();
  const links = useMemo(() => sampleLinks(), []);
  const [copied, setCopied] = useState<string | null>(null);
  const host = PAY_BASE.replace(/^https?:\/\//, "");

  const copy = async (id: string, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <>
      <PageHead
        title="Payment links"
        lead="Share a link or a QR code. Customers pay from any wallet, on any chain, and you get exactly the price in USDC."
        actions={
          <Link href="/dashboard/links/new" className="btn btn-accent btn-small">
            <Plus size={16} strokeWidth={1.5} /> New link
          </Link>
        }
      />

      {m.handle && (
        <div className="db-card db-mainlink">
          <div>
            <span className="db-strong">Your link</span>
            <span className="db-sub">Customers enter the amount. Good for invoices and tips.</span>
          </div>
          <span className="db-mono db-mainlink-url">
            {host}/{m.handle}
          </span>
          <button type="button" className="btn btn-outline btn-small" onClick={() => void copy("main", `${PAY_BASE}/${m.handle}`)}>
            {copied === "main" ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />} {copied === "main" ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      <section className="db-section">
        <div className="db-section-head">
          <h2 className="db-h2">
            Product links <SampleTag />
          </h2>
        </div>
        <SampleNotice>These links are examples. Links you create are saved once checkout is live.</SampleNotice>
        <div className="db-table" role="table" aria-label="Payment links">
          <div className="db-row db-row-head db-row-links" role="row">
            <span role="columnheader">Link</span>
            <span role="columnheader">Price</span>
            <span role="columnheader">Payments</span>
            <span role="columnheader" className="db-num">
              Received
            </span>
          </div>
          {links.map(l => (
            <div key={l.id} className="db-row db-row-links db-row-static" role="row">
              <span role="cell" className="db-cell-main">
                <span className="db-strong">
                  {l.title} {!l.active && <span className="db-badge tone-plain">Paused</span>}
                </span>
                <span className="db-sub">Created {shortDate(l.createdAt)}</span>
              </span>
              <span role="cell">{l.price === null ? <span className="db-sub">Customer chooses</span> : `${usdc(l.price)} USDC`}</span>
              <span role="cell" className="num">
                {l.paid}
              </span>
              <span role="cell" className="db-num db-strong">
                {usdc(l.total)} <span className="db-unit">USDC</span>
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
