"use client";

import { useEffect } from "react";
import { animate, AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import { Check, Copy, RotateCcw } from "lucide-react";

// The wall's panels: small pieces of real-looking product UI around one Morva order.
// All values are illustrative.

export type PanelId =
  | "walletBase"
  | "walletArb"
  | "walletTron"
  | "deposit"
  | "sign"
  | "quote"
  | "solvers"
  | "balance"
  | "escrow"
  | "link"
  | "webhook"
  | "ledger"
  | "payout"
  | "refund";

const MARK_D = "M20 68 V22 L50 54 L80 22 V66 C80 84 66 90 48 90 H30";

export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d={MARK_D} stroke="#0E1726" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={18} cy={90} r={6.5} fill="#1DB36B" />
    </svg>
  );
}

function Qr({ cells = 7 }: { cells?: number }) {
  return (
    <span className="w-qr" style={{ gridTemplateColumns: `repeat(${cells}, 1fr)` }} aria-hidden="true">
      {Array.from({ length: cells * cells }, (_, i) => (
        <span key={i} style={{ opacity: (i * 29 + (i % cells) * 7) % 5 < 2 ? 1 : 0 }} />
      ))}
    </span>
  );
}

function Num({ to, run, decimals = 2 }: { to: number; run: boolean; decimals?: number }) {
  const mv = useMotionValue(run ? to : 0);
  const text = useTransform(mv, v => v.toFixed(decimals));
  useEffect(() => {
    if (!run) return;
    mv.set(0);
    const c = animate(mv, to, { duration: 1, ease: "easeOut" });
    return () => c.stop();
  }, [run, mv, to]);
  return <motion.span className="num">{text}</motion.span>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="w-label">{children}</p>;
}

function Row({ a, b, strong }: { a: React.ReactNode; b: React.ReactNode; strong?: boolean }) {
  return (
    <div className="w-row">
      <span>{a}</span>
      <span className={`num${strong ? " w-strong" : ""}`}>{b}</span>
    </div>
  );
}

/** Content of each named panel. `lit` lets a panel play its own small moment while lit. */
export function PanelBody({ id, lit, branch }: { id: PanelId; lit: boolean; branch: "capture" | "refund" }) {
  switch (id) {
    case "walletBase":
      return (
        <>
          <Label>Wallet · Base</Label>
          <Row a="USDC" b="12.40" strong />
        </>
      );
    case "walletArb":
      return (
        <>
          <Label>Wallet · Arbitrum</Label>
          <Row a="USDC" b="9.10" strong />
        </>
      );
    case "walletTron":
      return (
        <>
          <Label>Wallet · Tron</Label>
          <Row a="USDT" b={branch === "refund" && lit ? "+25.00" : "10.00"} strong />
        </>
      );
    case "deposit":
      return (
        <>
          <Label>Deposit address</Label>
          <div className="w-deposit">
            <Qr />
            <span className="w-mono">TQ7k…9fXe</span>
          </div>
        </>
      );
    case "sign":
      return (
        <>
          <Label>Sign</Label>
          <p className="w-strong">Pay $25.00 to Northside Events</p>
          <span className="w-btn">Confirm</span>
        </>
      );
    case "quote":
      return (
        <>
          <Label>Quote · exact output</Label>
          <Row a="Merchant receives" b="25.00 USDC" strong />
          <Row a="Deadline" b="10 min" />
        </>
      );
    case "solvers":
      return (
        <>
          <Label>Solvers</Label>
          {["Solver A", "Solver B", "Solver C"].map((s, i) => (
            <div className="w-row" key={s}>
              <span>{s}</span>
              <span className="w-bid">
                <motion.span initial={false} animate={{ opacity: lit && i === 1 ? 0 : 1 }} className="w-muted">
                  bid
                </motion.span>
                <motion.span initial={false} animate={{ opacity: lit && i === 1 ? 1 : 0 }} className="w-ok">
                  <Check size={12} strokeWidth={1.5} /> filled
                </motion.span>
              </span>
            </div>
          ))}
        </>
      );
    case "balance":
      return (
        <>
          <Label>Your NEAR Intents balance</Label>
          <p className="w-big">
            $<Num to={25.25} run={lit} />
          </p>
          <p className="w-muted">Arbitrum · Base · Optimism</p>
        </>
      );
    case "escrow":
      return (
        <>
          <Label>Escrow</Label>
          <Row a="Held" b="25.00 USDC" strong />
          <Row a="Release" b="At check-in" />
        </>
      );
    case "link":
      return (
        <>
          <Label>Payment link</Label>
          <div className="w-link">
            <span className="w-mono">pay.morva.xyz/nse-25</span>
            <Copy size={13} strokeWidth={1.5} />
          </div>
        </>
      );
    case "webhook":
      return (
        <>
          <Label>Webhook</Label>
          <pre className="w-code">{`{ "type": "order.paid",\n  "amount": "25.00",\n  "asset": "USDC" }`}</pre>
        </>
      );
    case "ledger":
      return (
        <>
          <Label>Ledger</Label>
          <div className="w-ledger">
            <AnimatePresence initial={false}>
              {lit && (
                <motion.div
                  key="new"
                  className="w-row w-new"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <span>Builders’ night</span>
                  <span className="num">25.00</span>
                </motion.div>
              )}
            </AnimatePresence>
            <Row a="Event tee" b="30.00" />
            <Row a="Builders’ night" b="25.00" />
            <Row a="Payout" b="−400.00" />
          </div>
        </>
      );
    case "payout":
      return (
        <>
          <Label>Payout</Label>
          <Row a="USDC to Base" b="25.00" strong />
          <p className="w-muted">To the merchant’s chosen chain</p>
        </>
      );
    case "refund":
      return (
        <>
          <Label>Refund</Label>
          <div className="w-refund">
            <RotateCcw size={14} strokeWidth={1.5} />
            <span className="w-strong">25.00 back to USDT on Tron</span>
          </div>
        </>
      );
  }
}
