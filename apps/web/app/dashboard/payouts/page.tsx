"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { PAYOUT_CHAINS } from "@morva/domain";
import { ledgerCsv, sampleOrders, samplePayouts } from "../sample";
import { download, PageHead, SampleNotice, SampleTag, usdc, useSession, when } from "../_ui";

const PAYOUT_TONE = { sent: "mint", pending: "lilac", failed: "peach" } as const;
const PAYOUT_LABEL = { sent: "Sent", pending: "Sending", failed: "Failed, returned to balance" } as const;

export default function PayoutsPage() {
  const { m } = useSession();
  const payouts = useMemo(() => samplePayouts(), []);
  const chain = PAYOUT_CHAINS.find(c => c.id === m.payout_chain)?.label ?? m.payout_chain;

  return (
    <>
      <PageHead
        title="Payouts"
        lead="Money leaving your balance for your own wallet."
        actions={
          <button type="button" className="btn btn-outline btn-small" onClick={() => download(ledgerCsv(sampleOrders(), payouts), "morva-ledger-sample.csv")}>
            <Download size={16} strokeWidth={1.5} /> Export ledger
          </button>
        }
      />

      <section className="db-card db-payout-mode">
        <div>
          <span className="db-sub">How you get paid</span>
          {m.payout_mode === "auto_payout" ? (
            <p className="db-strong">
              Each payment goes straight to your wallet on {chain}: <span className="db-mono">{m.payout_address}</span>
            </p>
          ) : (
            <p className="db-strong">Payments collect in your Morva balance. Withdraw whenever you like.</p>
          )}
          {m.payout_mode === "auto_payout" && <p className="db-sub">Refunds after payment aren’t possible from Morva. Use holds if you may need to refund.</p>}
        </div>
        <Link href="/dashboard/settings#payout" className="btn btn-outline btn-small">
          Change
        </Link>
      </section>

      <section className="db-section">
        <div className="db-section-head">
          <h2 className="db-h2">
            History <SampleTag />
          </h2>
        </div>
        <SampleNotice>These payouts are examples. Your real withdrawals appear here.</SampleNotice>
        <div className="db-table" role="table" aria-label="Payouts">
          <div className="db-row db-row-head db-row-payouts" role="row">
            <span role="columnheader">Date</span>
            <span role="columnheader">To</span>
            <span role="columnheader">Status</span>
            <span role="columnheader" className="db-num">
              Amount
            </span>
          </div>
          {payouts.map(p => (
            <div key={p.id} className="db-row db-row-payouts db-row-static" role="row">
              <span role="cell" className="db-cell-main">
                <span className="db-strong">{p.kind === "withdrawal" ? "Withdrawal" : "Auto-payout"}</span>
                <span className="db-sub">{when(p.at)}</span>
              </span>
              <span role="cell" className="db-cell-paid">
                <span className="db-mono">{p.address}</span>
                <span className="db-sub">on {p.chain}</span>
              </span>
              <span role="cell">
                <span className={`db-badge tone-${PAYOUT_TONE[p.status]}`}>{PAYOUT_LABEL[p.status]}</span>
              </span>
              <span role="cell" className="db-num db-strong">
                {usdc(p.amount)} <span className="db-unit">USDC</span>
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
