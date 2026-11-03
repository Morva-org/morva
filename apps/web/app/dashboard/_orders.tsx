"use client";

import { useEffect, useRef, useState } from "react";
import { EyeOff, X } from "lucide-react";
import { PATH_LABEL, type SampleOrder } from "./sample";
import { SampleTag, StatusBadge, usdc, when } from "./_ui";

export function OrdersTable({ orders, onOpen }: { orders: SampleOrder[]; onOpen: (o: SampleOrder) => void }) {
  return (
    <div className="db-table" role="table" aria-label="Orders">
      <div className="db-row db-row-head" role="row">
        <span role="columnheader">Order</span>
        <span role="columnheader">Paid with</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" className="db-num">
          Amount
        </span>
      </div>
      {orders.map(o => (
        <button key={o.id} type="button" className="db-row" role="row" onClick={() => onOpen(o)}>
          <span role="cell" className="db-cell-main">
            <span className="db-strong">{o.item}</span>
            <span className="db-sub">
              {when(o.createdAt)} · {o.link}
            </span>
          </span>
          <span role="cell" className="db-cell-paid">
            {o.paidWith ? (
              <>
                <span>
                  {o.paidWith.amount} {o.paidWith.symbol}
                </span>
                <span className="db-sub">on {o.paidWith.chain}</span>
              </>
            ) : (
              <span className="db-sub">Not paid</span>
            )}
          </span>
          <span role="cell">
            <StatusBadge status={o.status} />
          </span>
          <span role="cell" className="db-num db-strong">
            {usdc(o.amount)} <span className="db-unit">USDC</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** One order: amounts, the payment's route, what happened, and what the merchant can do. */
export function OrderSheet({ order, onClose }: { order: SampleOrder | null; onClose: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setNote(null);
    if (!order) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, onClose]);

  if (!order) return null;
  const o = order;
  const actions: string[] =
    o.status === "held" ? ["Capture", "Void and refund"] : ["settled", "captured", "partially_refunded"].includes(o.status) && o.refunded < o.amount ? ["Refund"] : [];

  return (
    <div className="db-sheet-wrap" onClick={onClose}>
      <aside className="db-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={e => e.stopPropagation()}>
        <div className="db-sheet-top">
          <SampleTag />
          <button ref={closeRef} type="button" className="db-icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        <div className="db-sheet-head">
          <span className="db-sub">{o.item}</span>
          <h2 id="sheet-title" className="db-sheet-amount num">
            {usdc(o.amount)} <span className="db-unit">USDC</span>
          </h2>
          <div className="db-sheet-status">
            <StatusBadge status={o.status} />
            {o.confidential && (
              <span className="db-badge tone-plain">
                <EyeOff size={12} strokeWidth={1.5} /> Confidential
              </span>
            )}
          </div>
        </div>

        <dl className="db-facts">
          <div>
            <dt>Paid with</dt>
            <dd>{o.paidWith ? `${o.paidWith.amount} ${o.paidWith.symbol} on ${o.paidWith.chain}` : "Not paid"}</dd>
          </div>
          <div>
            <dt>You receive</dt>
            <dd>
              {usdc(o.amount)} USDC, exactly{o.refunded > 0 ? `, less ${usdc(o.refunded)} refunded` : ""}
            </dd>
          </div>
          <div>
            <dt>How they paid</dt>
            <dd>{PATH_LABEL[o.path]}</dd>
          </div>
          <div>
            <dt>Refunds go to</dt>
            <dd className="db-mono">{o.refundTo}</dd>
          </div>
          <div>
            <dt>From</dt>
            <dd>{o.link}</dd>
          </div>
          <div>
            <dt>Order ID</dt>
            <dd className="db-mono">{o.id}</dd>
          </div>
        </dl>

        <div className="db-timeline-wrap">
          <h3 className="db-h3">Activity</h3>
          <ol className="db-timeline">
            {o.timeline.map((t, i) => (
              <li key={i}>
                <span className="db-timeline-dot" aria-hidden="true" />
                <span>{t.label}</span>
                <span className="db-sub">{when(t.at)}</span>
              </li>
            ))}
          </ol>
        </div>

        {actions.length > 0 && (
          <div className="db-sheet-actions">
            {note && <p className="db-sub">{note}</p>}
            <div className="db-row-btns">
              {actions.map((a, i) => (
                <button
                  key={a}
                  type="button"
                  className={i === 0 ? "btn btn-accent" : "btn btn-outline"}
                  onClick={() => setNote(`This is a sample order, so nothing was sent. On a real order, ${a.toLowerCase()} asks for your passkey.`)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
