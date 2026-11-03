"use client";

import { useCallback, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { OrderSheet, OrdersTable } from "../_orders";
import { ledgerCsv, sampleOrders, samplePayouts, type OrderStatus, type SampleOrder } from "../sample";
import { download, PageHead, SampleNotice } from "../_ui";

const FILTERS: { id: string; label: string; match: (s: OrderStatus) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "held", label: "Held", match: s => s === "held" },
  { id: "settled", label: "Settled", match: s => s === "settled" || s === "captured" },
  { id: "refunds", label: "Refunds", match: s => ["refunding", "refunded", "partially_refunded", "voided"].includes(s) },
  { id: "attention", label: "Needs a look", match: s => ["underpaid", "failed", "expired"].includes(s) },
  { id: "pending", label: "In progress", match: s => s === "awaiting_payment" || s === "confirming" },
];

export default function OrdersPage() {
  const orders = useMemo(() => sampleOrders(), []);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<SampleOrder | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const match = FILTERS.find(f => f.id === filter)!.match;
  const needle = q.trim().toLowerCase();
  const shown = orders.filter(
    o => match(o.status) && (!needle || [o.item, o.link, o.id, o.paidWith?.chain ?? "", o.paidWith?.symbol ?? ""].some(v => v.toLowerCase().includes(needle))),
  );

  return (
    <>
      <PageHead
        title="Orders"
        lead="Every payment, hold and refund. Click an order for its full history."
        actions={
          <button type="button" className="btn btn-outline btn-small" onClick={() => download(ledgerCsv(orders, samplePayouts()), "morva-ledger-sample.csv")}>
            <Download size={16} strokeWidth={1.5} /> Export CSV
          </button>
        }
      />
      <SampleNotice />

      <div className="db-filters">
        <div className="db-chips" role="tablist" aria-label="Filter orders">
          {FILTERS.map(f => {
            const n = orders.filter(o => f.match(o.status)).length;
            return (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className="db-chip" onClick={() => setFilter(f.id)}>
                {f.label} <span className="db-chip-n num">{n}</span>
              </button>
            );
          })}
        </div>
        <label className="db-search">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          <input type="search" placeholder="Search orders" value={q} onChange={e => setQ(e.target.value)} aria-label="Search orders" />
        </label>
      </div>

      {shown.length ? (
        <OrdersTable orders={shown} onOpen={setOpen} />
      ) : (
        <div className="db-empty">
          <p className="db-strong">No orders match.</p>
          <p className="db-sub">Try another filter or search.</p>
        </div>
      )}

      <OrderSheet order={open} onClose={close} />
    </>
  );
}
