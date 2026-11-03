"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, Download, RefreshCw } from "lucide-react";
import { qrPng, qrSvg, api, ApiError, download as downloadBlob } from "../start/client";
import { OrderSheet, OrdersTable } from "./_orders";
import { dailyReceived, received, sampleOrders, type SampleOrder } from "./sample";
import { PageHead, PAY_BASE, SampleNotice, SampleTag, shortDate, usdc, useSession } from "./_ui";

interface Balance {
  account: string | null;
  lines: { asset_id: string; symbol: string | null; chain: string | null; decimals: number | null; amount: string; usd: number | null }[];
  usd_total: number;
}

export default function DashboardHome() {
  const { m } = useSession();
  const orders = useMemo(() => sampleOrders(), []);
  const [open, setOpen] = useState<SampleOrder | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const week = orders.filter(o => o.createdAt.getTime() > Date.now() - 7 * 86_400_000);
  const stats = [
    { label: "Received, last 7 days", value: usdc(week.reduce((s, o) => s + received(o), 0)), unit: "USDC" },
    { label: "Paid orders, last 7 days", value: String(week.filter(o => received(o) > 0 || o.status === "held").length), unit: "" },
    { label: "Held in escrow", value: usdc(orders.filter(o => o.status === "held").reduce((s, o) => s + o.amount, 0)), unit: "USDC" },
    { label: "Refunded, last 7 days", value: usdc(week.reduce((s, o) => s + o.refunded, 0)), unit: "USDC" },
  ];

  return (
    <>
      <PageHead title={m.business_name ? `${m.business_name}` : "Home"} lead="Your balance, your link and what’s happening with your orders." />

      <div className="db-grid-2">
        <BalanceCard />
        <LinkCard />
      </div>

      <SetupList />

      <section className="db-section">
        <div className="db-section-head">
          <h2 className="db-h2">
            Activity <SampleTag />
          </h2>
        </div>
        <div className="db-stats">
          {stats.map(s => (
            <div key={s.label} className="db-stat">
              <span className="db-stat-label">{s.label}</span>
              <span className="db-stat-value num">
                {s.value} {s.unit && <span className="db-unit">{s.unit}</span>}
              </span>
            </div>
          ))}
        </div>
        <VolumeChart orders={orders} />
      </section>

      <section className="db-section">
        <div className="db-section-head">
          <h2 className="db-h2">
            Recent orders <SampleTag />
          </h2>
          <Link href="/dashboard/orders" className="db-more">
            All orders <ArrowRight size={16} strokeWidth={1.5} />
          </Link>
        </div>
        <SampleNotice />
        <OrdersTable orders={orders.slice(0, 6)} onOpen={setOpen} />
      </section>

      <OrderSheet order={open} onClose={close} />
    </>
  );
}

/** The real balance, read live from the merchant's NEAR Intents account. */
function BalanceCard() {
  const { m } = useSession();
  const [b, setB] = useState<Balance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setB(await api<Balance>("GET", "/me/balance"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t read your balance.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="db-card db-balance">
      <div className="db-card-head">
        <h2 className="db-h3">Balance</h2>
        <button type="button" className="db-icon-btn" aria-label="Refresh balance" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} strokeWidth={1.5} className={loading ? "db-spin" : ""} />
        </button>
      </div>
      {!m.has_passkey ? (
        <>
          <p className="db-balance-value num">—</p>
          <p className="db-sub">Create your passkey to open your balance.</p>
          <Link href="/start" className="btn btn-outline btn-small">
            Protect your balance
          </Link>
        </>
      ) : error ? (
        <p className="db-error">{error}</p>
      ) : (
        <>
          <p className="db-balance-value num" aria-live="polite">
            {b ? usdc(b.usd_total) : "…"} <span className="db-unit">USD</span>
          </p>
          {b && b.lines.length > 0 ? (
            <ul className="db-lines">
              {b.lines.slice(0, 4).map(l => (
                <li key={l.asset_id}>
                  <span>
                    {l.symbol ?? "Other token"} {l.chain && <span className="db-sub">on {l.chain}</span>}
                  </span>
                  <span className="num">{l.decimals !== null ? (Number(l.amount) / 10 ** l.decimals).toLocaleString("en-US", { maximumFractionDigits: 6 }) : l.amount}</span>
                </li>
              ))}
            </ul>
          ) : (
            b && <p className="db-sub">Nothing here yet. Payments land in this balance as USDC.</p>
          )}
          <div className="db-card-foot">
            <span className="db-sub">Only your passkeys can move this money.</span>
            <button type="button" className="btn btn-outline btn-small" disabled title="Withdrawals arrive with checkout">
              Withdraw
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** The merchant's real pay link and QR. */
function LinkCard() {
  const { m } = useSession();
  const [copied, setCopied] = useState(false);
  const link = m.handle ? `${PAY_BASE}/${m.handle}` : null;
  const svg = useMemo(() => (link ? qrSvg(link) : ""), [link]);

  return (
    <section className="db-card db-linkcard">
      <div className="db-card-head">
        <h2 className="db-h3">Your link</h2>
      </div>
      {link ? (
        <div className="db-linkcard-body">
          <div className="db-qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="db-linkcard-text">
            <p className="db-link-url">
              {PAY_BASE.replace(/^https?:\/\//, "")}/<wbr />
              {m.handle}
            </p>
            <p className="db-sub">Customers enter an amount and pay from any wallet, on any chain.</p>
            <div className="db-row-btns">
              <button
                type="button"
                className="btn btn-accent btn-small"
                onClick={async () => {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />} {copied ? "Copied" : "Copy link"}
              </button>
              <button type="button" className="btn btn-outline btn-small" onClick={async () => downloadBlob(await qrPng(link), `morva-${m.handle}-qr.png`)}>
                <Download size={16} strokeWidth={1.5} /> QR
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="db-sub">
          Choose your link name in <Link href="/start">setup</Link>.
        </p>
      )}
    </section>
  );
}

/** Real things left to do: what onboarding let the merchant skip. */
function SetupList() {
  const { m } = useSession();
  const [devices, setDevices] = useState<number | null>(null);
  const [tested, setTested] = useState<boolean | null>(null);

  useEffect(() => {
    void api<{ passkeys: unknown[] }>("GET", "/me/passkeys")
      .then(r => setDevices(r.passkeys.length))
      .catch(() => setDevices(null));
    void api<{ test_payment: { refund_status: string | null } | null }>("GET", "/onboarding/test-payment")
      .then(r => setTested(Boolean(r.test_payment)))
      .catch(() => setTested(null));
  }, []);

  const items = [
    { done: m.has_passkey, label: "Protect your balance with a passkey", href: "/start" },
    { done: devices === null ? true : devices >= 2, label: "Add a backup device", body: "Withdrawals over $100 need one.", href: "/dashboard/settings#devices" },
    { done: Boolean(m.logo_url), label: "Add your logo", body: "Customers see it at checkout.", href: "/dashboard/settings#business" },
    { done: tested === null ? true : tested, label: "Try a $2 test payment", body: "See exactly what your customers see.", href: "/start" },
  ];
  const left = items.filter(i => !i.done);
  if (!left.length) return null;

  return (
    <section className="db-card db-setup">
      <div className="db-card-head">
        <h2 className="db-h3">Finish setting up</h2>
        <span className="db-sub num">
          {items.length - left.length} of {items.length} done
        </span>
      </div>
      <ul className="db-setup-list">
        {left.map(i => (
          <li key={i.label}>
            <Link href={i.href}>
              <span className="db-setup-dot" aria-hidden="true" />
              <span className="db-setup-text">
                <span className="db-strong">{i.label}</span>
                {i.body && <span className="db-sub">{i.body}</span>}
              </span>
              <ArrowRight size={16} strokeWidth={1.5} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Received USDC per day, last 14 days: one series, so no legend; the title names it. */
function VolumeChart({ orders }: { orders: SampleOrder[] }) {
  const days = useMemo(() => dailyReceived(orders, 14), [orders]);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map(d => d.total), 1);
  const top = Math.ceil(max / 100) * 100;

  return (
    <figure className="db-chart">
      <figcaption className="db-chart-title">Received per day, last 14 days (USDC)</figcaption>
      <div className="db-chart-plot" onMouseLeave={() => setHover(null)}>
        <div className="db-chart-grid" aria-hidden="true">
          <span>{top}</span>
          <span>{top / 2}</span>
          <span>0</span>
        </div>
        <div className="db-chart-bars" aria-hidden="true">
          {days.map((d, i) => (
            <div key={i} className="db-chart-col" onMouseEnter={() => setHover(i)}>
              <span className={`db-chart-bar${hover === i ? " is-hover" : ""}`} style={{ height: `${(d.total / top) * 100}%` }} />
              {hover === i && (
                <span className="db-chart-tip" style={{ bottom: `${(d.total / top) * 100}%` }}>
                  <span className="db-strong num">{usdc(d.total)} USDC</span>
                  <span className="db-sub">{shortDate(d.day)}</span>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="db-chart-x" aria-hidden="true">
        <span>{shortDate(days[0]!.day)}</span>
        <span>Today</span>
      </div>
      <table className="sr-only">
        <caption>Received per day, sample data</caption>
        <tbody>
          {days.map((d, i) => (
            <tr key={i}>
              <th scope="row">{shortDate(d.day)}</th>
              <td>{usdc(d.total)} USDC</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
