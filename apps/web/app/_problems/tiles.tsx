"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { ArrowDown, Check, RotateCcw } from "lucide-react";

// Six small looping product moments: each shows a checkout failure, then Morva's fix.
// A tile renders purely from `step`; the conductor in ProblemGrid advances it. All mock data.

export interface TileSpec {
  /** How long each step lasts, in ms. The last step is the resting "fixed" frame. */
  steps: number[];
  /** Step that shows the failure at its worst, for the reduced-motion still. */
  failStep: number;
  Frame: (props: { step: number }) => React.ReactNode;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const T = { duration: 0.35, ease: EASE };
const icon = { size: 14, strokeWidth: 1.5 } as const;

/** Shown/hidden layer: opacity and a small lift, both transform-free of layout. */
function Layer({ on, children, className = "", y = 6, delay = 0 }: { on: boolean; children: React.ReactNode; className?: string; y?: number; delay?: number }) {
  return (
    <motion.div
      className={`m-layer ${className}`}
      initial={false}
      animate={{ opacity: on ? 1 : 0, y: on ? 0 : y }}
      transition={{ ...T, delay: on ? delay : 0 }}
    >
      {children}
    </motion.div>
  );
}

/** A number that tweens to its new value, rendered through a motion value (no re-renders). */
function Num({ value, decimals = 2, duration = 0.9 }: { value: number; decimals?: number; duration?: number }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, v => v.toFixed(decimals));
  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: "easeOut" });
    return () => controls.stop();
  }, [mv, value, duration]);
  return <motion.span className="num">{text}</motion.span>;
}

// 1. The wrong network --------------------------------------------------------------------
function WrongNetwork({ step }: { step: number }) {
  const wrong = step >= 1 && step <= 4;
  const fixed = step >= 5;
  return (
    <div className="m-card m-send">
      <p className="m-title">Send 25 USDC</p>
      <div className="m-row m-slot">
        <Layer on={!fixed}>
          <span className="muted">Network</span>
          <span className="m-select">
            <Layer on={!wrong} y={-8} className="m-select-option">
              Base
            </Layer>
            <Layer on={wrong} y={8} className="m-select-option m-err">
              Tron
            </Layer>
          </span>
        </Layer>
        <Layer on={fixed}>
          <span>Network: handled by Morva</span>
          <Check {...icon} className="m-ok" />
        </Layer>
      </div>
      <div className="m-row">
        <span className="muted">To</span>
        <span className={`m-mono ${step >= 2 && step <= 4 ? "m-err" : ""}`}>0x5aed…67de</span>
      </div>
      <div className="m-foot">
        <Layer on={step >= 3 && step <= 4} className="m-err-line">
          Sent on the wrong network
        </Layer>
        <Layer on={fixed} className="m-ok-line" delay={0.15}>
          <Check {...icon} /> Arrives as USDC, any chain
        </Layer>
      </div>
    </div>
  );
}

// 2. Payments that arrive short -----------------------------------------------------------
function ArrivesShort({ step }: { step: number }) {
  const received = step >= 1 && step <= 3 ? 63.97 : 64;
  const fixed = step >= 4;
  return (
    <div className="m-card">
      <p className="m-title">Invoice 1042</p>
      <div className="m-row">
        <span className="muted">Invoiced</span>
        <span className="num">64.00</span>
      </div>
      <div className="m-row">
        <span className="muted">Received</span>
        <span className="m-received">
          <Num value={received} />
          <Layer on={fixed} className="m-exact" delay={0.6}>
            exact
          </Layer>
        </span>
      </div>
      <div className="m-foot">
        <Layer on={step >= 2 && step <= 3} className="m-err-line">
          Short by 0.03
        </Layer>
        <Layer on={fixed} className="m-ok-line" delay={0.7}>
          <Check {...icon} /> Nothing to chase
        </Layer>
      </div>
    </div>
  );
}

// 3. Refunds that bounce ------------------------------------------------------------------
const PARTIES = ["Merchant", "Processor", "Exchange"];
const ROW = 58; // vertical distance between parties, px

function RefundBounce({ step }: { step: number }) {
  const at = [0, 1, 2, 0][Math.min(step, 3)]!;
  const fixed = step >= 5;
  return (
    <div className="m-bounce">
      {PARTIES.map((p, i) => (
        <motion.span
          key={p}
          className="m-party"
          style={{ top: i * ROW }}
          initial={false}
          animate={{ opacity: fixed && i > 0 ? 0.35 : 1 }}
          transition={T}
        >
          {p}
        </motion.span>
      ))}
      {[0, 1].map(i => (
        <motion.span
          key={i}
          className="m-party-arrow"
          style={{ top: i * ROW + 38 }}
          initial={false}
          animate={{ opacity: fixed ? 0 : 1 }}
          transition={T}
        >
          <ArrowDown size={12} strokeWidth={1.5} />
        </motion.span>
      ))}
      <motion.div
        className="m-refund-card"
        initial={false}
        animate={{ y: at * ROW, opacity: fixed ? 0 : 1 }}
        transition={{ duration: 0.45, ease: EASE }}
      >
        <RotateCcw size={12} strokeWidth={1.5} /> Refund 25.00
      </motion.div>
      <svg className="m-bounce-line" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
        <motion.path
          d="M0 5 H100"
          initial={false}
          animate={{ pathLength: fixed ? 1 : 0, opacity: fixed ? 1 : 0 }}
          transition={{ duration: fixed ? 0.45 : 0.25, ease: EASE }}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <Layer on={fixed} className="m-tron" delay={0.35} y={0}>
        <span className="m-chip">USDT · tron</span>
        <span className="m-ok-text">
          <Check {...icon} /> Refunded
        </span>
      </Layer>
    </div>
  );
}

// 4. USDC but no gas (dark tile) ----------------------------------------------------------
function NoGas({ step }: { step: number }) {
  const fixed = step >= 4;
  const paid = step >= 5;
  return (
    <div className="m-card m-card-dark">
      <p className="m-title">Wallet</p>
      <div className="m-row">
        <span>USDC</span>
        <span className="num">50.00</span>
      </div>
      <motion.div className="m-row" initial={false} animate={{ opacity: fixed ? 0.3 : 1 }} transition={T}>
        <span>ETH</span>
        <span className={`num ${step >= 2 && !fixed ? "m-err-dark" : ""}`}>0.00</span>
      </motion.div>
      <motion.div
        className="m-pay"
        initial={false}
        animate={step === 1 ? { x: [0, -5, 5, -3, 3, 0] } : { x: 0, scale: step === 5 ? [1, 0.97, 1] : 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <Layer on={!fixed} y={0}>
          Pay
        </Layer>
        <Layer on={fixed && !paid} y={0}>
          Pay 25.00
        </Layer>
        <Layer on={paid} y={0}>
          Paid
        </Layer>
      </motion.div>
      <div className="m-foot">
        <Layer on={step >= 1 && step <= 3} className="m-err-text-dark">
          Not enough gas
        </Layer>
        <Layer on={paid} className="m-ok-text-dark" delay={0.2}>
          <Check {...icon} /> Gas covered
        </Layer>
      </div>
    </div>
  );
}

// 5. Signing fear -------------------------------------------------------------------------
const HEX = [
  "0x7a3f9c0d…e9c1",
  "data: 0x095ea7b3",
  "000000000000000000000000",
  "3fc91a3afd70395cd496c647",
  "d5a6cc9d4b2b7fad00000000",
  "ffffffffffffffffffffffff",
];

function SigningFear({ step }: { step: number }) {
  const fixed = step >= 3;
  return (
    <div className="m-sign">
      <Layer on={!fixed} y={0} className="m-card m-sign-card">
        <p className="m-title">Signature request</p>
        <div className="m-hex">
          <motion.div
            initial={false}
            animate={{ y: step >= 1 && step <= 2 ? -44 : 0 }}
            transition={{ duration: step === 1 ? 2.2 : 0.3, ease: "linear" }}
          >
            {HEX.map(line => (
              <span key={line} className="m-mono">
                {line}
              </span>
            ))}
          </motion.div>
        </div>
        <div className="m-actions">
          <span className="m-btn m-btn-outline">Reject</span>
          <span className="m-btn m-btn-outline">Sign</span>
        </div>
      </Layer>
      <Layer on={fixed} y={0} className="m-card m-sign-card">
        <p className="m-title">Pay 25.00 USDC</p>
        <p className="muted">to Lagos Builders Night</p>
        <p className="m-plain-note">One payment. Nothing else is approved.</p>
        <div className="m-actions">
          <span className="m-btn">Approve</span>
        </div>
      </Layer>
    </div>
  );
}

// 6. Money in five places -----------------------------------------------------------------
const PILES = [
  { label: "$9", chain: "Arbitrum", x: 0, y: 46, usd: 9 },
  { label: "$12", chain: "Base", x: 34, y: 92, usd: 12 },
  { label: "$6", chain: "Tron", x: 58, y: 52, usd: 6 },
  { label: "$4", chain: "Solana", x: 8, y: 138, usd: 4 },
  { label: "$3", chain: "Ethereum", x: 50, y: 146, usd: 3 },
];

function FivePlaces({ step }: { step: number }) {
  const fixed = step >= 3;
  return (
    <div className="m-piles">
      <span className="m-tag">Ticket $25</span>
      <Layer on={step >= 1 && step <= 2} className="m-piles-note" y={0}>
        No balance covers $25 on its own
      </Layer>
      {PILES.map((p, i) => (
        <motion.div
          key={p.chain}
          className="m-pile-track"
          initial={false}
          animate={fixed ? { x: "30%", y: 120, opacity: 0, scale: 0.7 } : { x: `${p.x}%`, y: p.y, opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: EASE, delay: fixed ? i * 0.06 : i * 0.04 }}
        >
          <span className="m-chip m-pile">
            <span className="num">{p.label}</span> <span className="muted">{p.chain}</span>
          </span>
        </motion.div>
      ))}
      <Layer on={fixed} className="m-bar" delay={0.35} y={8}>
        <span className="m-bar-head">
          <span className="m-title num">$34 available</span>
          <span className="m-btn">Pay $25</span>
        </span>
        <span className="m-bar-segments">
          {PILES.map((p, i) => (
            <motion.span
              key={p.chain}
              style={{ flexGrow: p.usd }}
              initial={false}
              animate={{ scaleX: fixed ? 1 : 0 }}
              transition={{ duration: 0.4, ease: EASE, delay: fixed ? 0.45 + i * 0.06 : 0 }}
            />
          ))}
        </span>
      </Layer>
    </div>
  );
}

export const TILES: TileSpec[] = [
  { steps: [800, 500, 600, 900, 500, 600, 1600], failStep: 3, Frame: WrongNetwork },
  { steps: [700, 1000, 900, 500, 1100, 1600], failStep: 2, Frame: ArrivesShort },
  { steps: [600, 600, 600, 600, 400, 800, 1600], failStep: 2, Frame: RefundBounce },
  { steps: [700, 600, 900, 500, 700, 700, 1500], failStep: 2, Frame: NoGas },
  { steps: [400, 2200, 500, 500, 2000], failStep: 1, Frame: SigningFear },
  { steps: [700, 1400, 500, 700, 2200], failStep: 2, Frame: FivePlaces },
];
