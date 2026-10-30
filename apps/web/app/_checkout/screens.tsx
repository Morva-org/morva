"use client";

import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { Check, ChevronLeft, X } from "lucide-react";

// The phone's six scenes. Each renders purely from `sub`, its current sub-step. All mock data.

const EASE = [0.22, 1, 0.36, 1] as const;
const T = { duration: 0.4, ease: EASE };
const icon = { size: 14, strokeWidth: 1.5 } as const;
const MARK_D = "M20 68 V22 L50 54 L80 22 V66 C80 84 66 90 48 90 H30";

export interface SceneSpec {
  /** Sub-step durations in ms. */
  subs: number[];
  /** Where the fake finger taps, per sub-step, in screen coordinates (360 x 736). */
  taps?: Record<number, [number, number]>;
  Screen: (props: { sub: number }) => React.ReactNode;
  view: "Buyer view" | "Merchant view";
}

export function Mark({ size = 20, ink = "#0E1726" }: { size?: number; ink?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path d={MARK_D} stroke={ink} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={18} cy={90} r={6.5} fill="#1DB36B" />
    </svg>
  );
}

function Show({ on, children, y = 10, delay = 0, className = "", style }: { on: boolean; children: React.ReactNode; y?: number; delay?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={false}
      animate={{ opacity: on ? 1 : 0, y: on ? 0 : y }}
      transition={{ ...T, delay: on ? delay : 0 }}
    >
      {children}
    </motion.div>
  );
}

function Num({ to, from = 0, decimals = 2, run, duration = 0.9, comma = false }: { to: number; from?: number; decimals?: number; run: boolean; duration?: number; comma?: boolean }) {
  const mv = useMotionValue(run ? to : from);
  const text = useTransform(mv, v => (comma ? v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals)));
  useEffect(() => {
    if (!run) {
      mv.set(from);
      return;
    }
    const c = animate(mv, to, { duration, ease: "easeOut" });
    return () => c.stop();
  }, [run, mv, to, from, duration]);
  return <motion.span className="num">{text}</motion.span>;
}

// 1. Chat ----------------------------------------------------------------------------------
function Chat({ sub }: { sub: number }) {
  return (
    <div className="ph-screen ph-chat">
      <div className="ph-chat-head">
        <ChevronLeft size={20} strokeWidth={1.5} />
        <span className="ph-avatar">NE</span>
        <span className="ph-chat-name">Northside Events</span>
      </div>
      <div className="ph-thread">
        <p className="ph-day">Today</p>
        <Show on={sub >= 1} className="ph-bubble">
          Here’s your ticket link for Builders’ night.
          <span className="ph-time">18:58</span>
        </Show>
        <Show on={sub >= 2} className="ph-bubble ph-link" delay={0.1}>
          <span className="ph-link-art">
            <Mark size={36} />
          </span>
          <span className="ph-link-body">
            <span className="ph-strong">Pay $25.00 · Builders’ night ticket</span>
            <span className="ph-domain">pay.morva.xyz</span>
          </span>
        </Show>
      </div>
      <div className="ph-composer">
        <span>Message</span>
      </div>
    </div>
  );
}

// 2 + 3. Checkout sheet -------------------------------------------------------------------
const ROWS = [
  { name: "USDC on Base", detail: "$12.40" },
  { name: "USDC on Arbitrum", detail: "$9.10" },
  { name: "USDC on Optimism", detail: "Move $3.75 of $6.00" },
];

type RowState = "idle" | "approving" | "moving" | "received";

function Checkout({ sub, approve }: { sub: number; approve?: number }) {
  const rowsIn = approve !== undefined || sub >= 2;
  const states: RowState[] = ROWS.map((_, i) => {
    if (approve === undefined || approve < 2) return "idle";
    if (approve === 2) return "approving";
    if (approve === 3) return i === 0 ? "moving" : i === 1 ? "moving" : "approving";
    return "received";
  });
  return (
    <div className="ph-screen ph-sheet">
      <div className="ph-browser">
        <X size={16} strokeWidth={1.5} />
        <span className="ph-domain">pay.morva.xyz</span>
        <span style={{ width: 16 }} />
      </div>
      <div className="ph-pad">
        <p className="ph-meta">Northside Events · Builders’ night ticket</p>
        <p className="ph-big num">$25.00</p>
        <div className="ph-tabs">
          <span className="ph-tab ph-tab-on">Wallet</span>
          <span className="ph-tab">From an exchange</span>
        </div>
        <p className="ph-available">
          $<Num to={27.5} run={approve !== undefined || sub >= 1} /> available across 3 chains
        </p>
        <div className="ph-rows">
          {ROWS.map((r, i) => (
            <Show key={r.name} on={rowsIn} delay={0.1 + i * 0.12} className="ph-row">
              <span className="ph-row-text">
                <span>{r.name}</span>
                <span className="ph-meta">{r.detail}</span>
              </span>
              <RowStatus state={states[i]!} delay={i * 0.25} />
              <span className="ph-row-track">
                <motion.span
                  initial={false}
                  animate={{ scaleX: states[i] === "received" ? 1 : states[i] === "moving" ? 0.6 : 0 }}
                  transition={{ duration: states[i] === "moving" ? 1.2 : 0.5, ease: EASE, delay: i * 0.25 }}
                />
              </span>
            </Show>
          ))}
          <Show on={rowsIn} delay={0.5} className="ph-row ph-row-muted">
            <span className="ph-row-text">
              <span>USDC on Polygon</span>
              <span className="ph-meta">$0.30</span>
            </span>
            <span className="ph-meta">Too small to move</span>
          </Show>
        </div>
        <Show on={approve !== undefined && approve >= 2} className="ph-note">
          Moving into your own NEAR Intents balance
        </Show>
      </div>
      <Show on={approve !== undefined} className="ph-bottom" y={20}>
        <span className="ph-btn ph-btn-block">{approve !== undefined && approve >= 4 ? "Ready to pay" : "Approve all"}</span>
      </Show>
    </div>
  );
}

const STATUS_LABEL = { approving: "Approving", moving: "Moving", received: "Received" } as const;

/** The three labels are stacked in one fixed box and cross-fade, so the row never reflows. */
function RowStatus({ state, delay }: { state: RowState; delay: number }) {
  return (
    <span className="ph-status">
      {(["approving", "moving", "received"] as const).map(s => (
        <motion.span
          key={s}
          className={s === "received" ? "ph-ok" : "ph-meta"}
          initial={false}
          animate={{ opacity: state === s ? 1 : 0 }}
          transition={{ duration: 0.3, delay: state === s ? delay : 0 }}
        >
          {s === "received" && <Check {...icon} />}
          {STATUS_LABEL[s]}
        </motion.span>
      ))}
    </span>
  );
}

// 4. Sign once ----------------------------------------------------------------------------
function TravellingMark({ run }: { run: boolean }) {
  const path = useRef<SVGPathElement>(null);
  const progress = useMotionValue(run ? 1 : 0);
  const point = (p: number) => {
    const el = path.current;
    if (!el) return { x: 18, y: 90 };
    if (p >= 1) return { x: 18, y: 90 };
    const len = el.getTotalLength();
    const travel = Math.min(1, p / 0.85);
    const pt = el.getPointAtLength(len * travel);
    // After the stroke ends at (30, 90), the dot settles back to its resting place at (18, 90).
    const settle = Math.max(0, (p - 0.85) / 0.15);
    return { x: pt.x + (18 - pt.x) * settle, y: pt.y + (90 - pt.y) * settle };
  };
  const x = useTransform(progress, p => point(p).x - 18);
  const y = useTransform(progress, p => point(p).y - 90);
  useEffect(() => {
    if (!run) {
      progress.set(0);
      return;
    }
    const c = animate(progress, 1, { duration: 1.3, ease: "easeInOut" });
    return () => c.stop();
  }, [run, progress]);
  return (
    <svg width={64} height={64} viewBox="0 0 100 100" fill="none" aria-hidden="true" overflow="visible">
      <path ref={path} d={MARK_D} stroke="#0E1726" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
      <motion.circle cx={18} cy={90} r={6.5} fill="#1DB36B" style={{ x, y }} />
    </svg>
  );
}

function Sign({ sub }: { sub: number }) {
  return (
    <div className="ph-screen">
      <Checkout sub={3} approve={4} />
      <motion.div className="ph-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} />
      <motion.div className="ph-sign" initial={{ y: 320 }} animate={{ y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
        <span className="ph-grabber" />
        <TravellingMark run={sub >= 2} />
        <p className="ph-sign-title">Pay $25.00 to Northside Events</p>
        <p className="ph-meta">From your balance across 3 chains</p>
        <span className="ph-btn ph-btn-accent ph-btn-block">Confirm</span>
      </motion.div>
    </div>
  );
}

// 5. Paid and ticket ----------------------------------------------------------------------
const QR = Array.from({ length: 81 }, (_, i) => ((i * 37 + (i % 9) * 11) % 7 < 3 ? 1 : 0));

function Paid({ sub }: { sub: number }) {
  return (
    <div className="ph-screen ph-paid">
      <div className="ph-pad ph-paid-head">
        <span className="ph-ok ph-paid-label">
          <Check size={18} strokeWidth={1.5} /> Paid
        </span>
        <p className="ph-big num">$25.00</p>
        <p className="ph-meta">
          Ref <span className="ph-mono">MRV-4821</span>
        </p>
      </div>
      <Show on={sub >= 1} y={40} className="ph-ticket">
        <div className="ph-ticket-main">
          <span className="ph-ticket-brand">
            <Mark size={18} ink="#FFFFFF" /> morva
          </span>
          <span className="ph-ticket-title">Builders’ night</span>
          <span className="ph-ticket-meta">Sat 21 Nov · 19:00</span>
          <span className="ph-ticket-meta ph-mono">ADMIT ONE</span>
        </div>
        <div className="ph-qr" aria-hidden="true">
          {QR.map((on, i) => (
            <span key={i} style={{ opacity: on ? 1 : 0 }} />
          ))}
          <span className="ph-qr-label">sample</span>
        </div>
      </Show>
      <Show on={sub >= 1} delay={0.3} className="ph-change">
        $0.25 change stays in your balance
      </Show>
    </div>
  );
}

// 6. Merchant receives --------------------------------------------------------------------
const ORDERS = [
  ["18:47", "Builders’ night", "Base", "25.00"],
  ["18:31", "Event tee", "Tron", "30.00"],
  ["17:55", "Builders’ night", "Solana", "25.00"],
];

function Merchant({ sub }: { sub: number }) {
  return (
    <div className="ph-screen ph-merchant">
      <div className="ph-app-head">
        <span className="ph-ticket-brand ph-ink">
          <Mark size={18} /> morva
        </span>
        <span className="ph-meta">Northside Events</span>
      </div>
      <div className="ph-pad">
        <div className="ph-balance">
          <span className="ph-meta">Balance</span>
          <span className="ph-big-sm">
            <Num from={1240} to={1265} run={sub >= 2} comma duration={1.2} /> USDC
          </span>
        </div>
        <p className="ph-section">Today</p>
        <div className="ph-orders">
          <motion.div
            className="ph-order ph-order-new"
            initial={false}
            animate={{ opacity: sub >= 2 ? 1 : 0, y: sub >= 2 ? 0 : -12 }}
            transition={T}
          >
            <span className="ph-row-text">
              <span>Builders’ night</span>
              <span className="ph-meta">19:02 · Paid from 3 chains</span>
            </span>
            <span className="num ph-strong">25.00 USDC</span>
          </motion.div>
          <motion.div style={{ marginTop: 64 }} initial={false} animate={{ y: sub >= 2 ? 0 : -64 }} transition={T}>
            {ORDERS.map(([time, item, chain, amount]) => (
              <div className="ph-order" key={time}>
                <span className="ph-row-text">
                  <span>{item}</span>
                  <span className="ph-meta">
                    {time} · {chain}
                  </span>
                </span>
                <span className="num">{amount} USDC</span>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
      <motion.div
        className="ph-notify"
        initial={false}
        animate={{ y: sub >= 1 ? 0 : -110, opacity: sub >= 1 ? 1 : 0 }}
        transition={{ duration: 0.45, ease: EASE }}
      >
        <span className="ph-notify-icon">
          <Mark size={18} />
        </span>
        <span className="ph-row-text">
          <span className="ph-strong">Northside Events received 25.00 USDC</span>
          <span className="ph-meta">now · Builders’ night</span>
        </span>
      </motion.div>
    </div>
  );
}

export const SCENES: SceneSpec[] = [
  { subs: [500, 900, 1300, 800], taps: { 3: [180, 330] }, Screen: Chat, view: "Buyer view" },
  { subs: [700, 1100, 1500, 500], Screen: ({ sub }) => <Checkout sub={sub} />, view: "Buyer view" },
  {
    subs: [600, 700, 800, 1300, 1300, 500],
    taps: { 1: [180, 676] },
    Screen: ({ sub }) => <Checkout sub={3} approve={sub} />,
    view: "Buyer view",
  },
  { subs: [900, 700, 1300, 500], taps: { 1: [180, 664] }, Screen: Sign, view: "Buyer view" },
  { subs: [1000, 1700, 1100], Screen: Paid, view: "Buyer view" },
  { subs: [700, 1200, 1900, 1400], Screen: Merchant, view: "Merchant view" },
];

