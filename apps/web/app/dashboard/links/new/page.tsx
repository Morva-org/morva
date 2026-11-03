"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { qrSvg } from "../../../start/client";
import { PageHead, PAY_BASE, usdc, useSession } from "../../_ui";

/** Builds a product link with a live preview of what buyers see. Saving arrives with checkout. */
export default function NewLinkPage() {
  const { m } = useSession();
  const [title, setTitle] = useState("");
  const [fixed, setFixed] = useState(true);
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [tried, setTried] = useState(false);

  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "your-product";
  const url = `${PAY_BASE}/${m.handle ?? "you"}/${slug}`;
  const svg = useMemo(() => qrSvg(url), [url]);
  const amount = Number(price);
  const priceOk = !fixed || (Number.isFinite(amount) && amount >= 1 && amount <= 100_000);
  const ready = title.trim().length > 0 && priceOk;

  return (
    <>
      <Link href="/dashboard/links" className="db-backlink">
        <ArrowLeft size={16} strokeWidth={1.5} /> Payment links
      </Link>
      <PageHead title="New payment link" lead="Name it, set the price, and share it anywhere." />

      <div className="db-split">
        <form
          className="db-card db-form"
          onSubmit={e => {
            e.preventDefault();
            setTried(true);
          }}
        >
          <label className="field">
            Name
            <input value={title} maxLength={80} placeholder="General admission" onChange={e => setTitle(e.target.value)} />
          </label>

          <div className="field">
            Price
            <div className="db-seg" role="radiogroup" aria-label="Price">
              <button type="button" role="radio" aria-checked={fixed} onClick={() => setFixed(true)}>
                Fixed price
              </button>
              <button type="button" role="radio" aria-checked={!fixed} onClick={() => setFixed(false)}>
                Customer chooses
              </button>
            </div>
          </div>
          {fixed && (
            <label className="field">
              Amount
              <span className="db-input-unit">
                <input inputMode="decimal" value={price} placeholder="25.00" onChange={e => setPrice(e.target.value.replace(/[^\d.]/g, ""))} />
                <span>USDC</span>
              </span>
              {price && !priceOk && <span className="db-error">Between 1 and 100,000 USDC.</span>}
              <span className="db-sub">You receive exactly this. The buyer covers swap costs.</span>
            </label>
          )}
          <label className="field">
            <span>
              Description <span className="db-sub">(optional)</span>
            </span>
            <textarea rows={3} maxLength={280} value={description} onChange={e => setDescription(e.target.value)} />
          </label>

          {tried ? (
            <p className="db-sample-note">
              Saving links arrives with checkout. This preview is exactly what buyers will see.{" "}
              <button type="button" className="db-quiet" onClick={() => setTried(false)}>
                OK
              </button>
            </p>
          ) : (
            <button type="submit" className="btn btn-accent btn-block" disabled={!ready}>
              Create link
            </button>
          )}
        </form>

        <div className="db-preview" aria-label="Buyer preview">
          <span className="db-sub">What buyers see</span>
          <div className="db-preview-card">
            <div className="db-preview-merchant">
              {m.logo_url ? <img src={m.logo_url} alt="" width={36} height={36} /> : <span className="db-preview-logo" />}
              <span className="db-strong">{m.business_name ?? "Your business"}</span>
            </div>
            <span className="db-preview-title">{title.trim() || "Your product"}</span>
            {description.trim() && <span className="db-sub">{description.trim()}</span>}
            <span className="db-preview-price num">{fixed ? (priceOk && price ? `${usdc(amount)} USDC` : "— USDC") : "Customer enters amount"}</span>
            <span className="btn btn-accent btn-block db-preview-pay" aria-hidden="true">
              Pay with crypto
            </span>
            <span className="db-sub db-center">Any wallet, any chain</span>
          </div>
          <div className="db-preview-qr">
            <div className="db-qr" dangerouslySetInnerHTML={{ __html: svg }} />
            <span className="db-mono db-preview-url">{url.replace(/^https?:\/\//, "")}</span>
          </div>
        </div>
      </div>
    </>
  );
}
