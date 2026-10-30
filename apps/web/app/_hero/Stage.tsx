"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, RotateCcw } from "lucide-react";
import { chevron, elbowPath, type Dir } from "./geometry";

// The product stage for "One balance. Every chain. Everything after the payment."
// One anchor, the Morva pass, stays on stage; small fragments of product UI gather around it.
// Every element is always mounted and moves to per-scene targets with transforms only, so a
// scene change morphs the picture and never shifts layout. All values are example data.

export const STAGE_ID = "product-stage";
export const SCENE_COUNT = 5;
export const SCENE_NAMES = [
  "Paying from three chains into one pass",
  "The exact amount received",
  "A held order, and a refund back to Tron",
  "One sale split three ways",
  "The merchant dashboard and the buyer's checkout",
];

type El = "window" | "phone" | "balance" | "route" | "hold" | "refund" | "split0" | "split1" | "split2" | "pass";
const ELEMENTS: El[] = ["window", "phone", "balance", "route", "hold", "refund", "split0", "split1", "split2", "pass"];

interface Target {
  x: number;
  y: number;
  s?: number;
}
type Point = [number, number];
interface Connector {
  d: string;
  start: Point;
  end: Point;
  dir: Dir;
}
interface Canvas {
  w: number;
  h: number;
  size: Record<El, { w: number; h: number }>;
  /** Visible elements per scene, in entrance order. */
  scenes: Partial<Record<El, Target>>[];
  connectors: Connector[][];
  drift: (El | null)[];
}

const sign = (n: number) => (n < 0 ? -1 : 1);

/** An L-shaped connector with one rounded corner: horizontal first, or vertical first. */
function lPath(a: Point, b: Point, first: "h" | "v"): Connector {
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5) {
    const dir: Dir = Math.abs(dx) < 0.5 ? (dy > 0 ? "down" : "up") : dx > 0 ? "right" : "left";
    return { d: `M${ax} ${ay}L${bx} ${by}`, start: a, end: b, dir };
  }
  const r = Math.min(10, Math.abs(dx), Math.abs(dy));
  if (first === "h") {
    const d = `M${ax} ${ay}H${bx - sign(dx) * r}Q${bx} ${ay} ${bx} ${ay + sign(dy) * r}V${by}`;
    return { d, start: a, end: b, dir: dy > 0 ? "down" : "up" };
  }
  const d = `M${ax} ${ay}V${by - sign(dy) * r}Q${ax} ${by} ${ax + sign(dx) * r} ${by}H${bx}`;
  return { d, start: a, end: b, dir: dx > 0 ? "right" : "left" };
}

function elbow(a: Point, b: Point, mid: number): Connector {
  return { d: elbowPath(a, b, "x", mid), start: a, end: b, dir: b[0] > mid ? "right" : "left" };
}

const DESKTOP: Canvas = {
  w: 640,
  h: 540,
  size: {
    pass: { w: 288, h: 168 },
    balance: { w: 290, h: 208 },
    route: { w: 320, h: 64 },
    hold: { w: 268, h: 184 },
    refund: { w: 268, h: 76 },
    split0: { w: 240, h: 52 },
    split1: { w: 240, h: 52 },
    split2: { w: 240, h: 52 },
    window: { w: 470, h: 330 },
    phone: { w: 170, h: 300 },
  },
  scenes: [
    { pass: { x: 336, y: 170 }, balance: { x: 0, y: 36 }, route: { x: 304, y: 380 } },
    { pass: { x: 176, y: 186 } },
    { pass: { x: 8, y: 48 }, hold: { x: 356, y: 24 }, refund: { x: 356, y: 300 } },
    { pass: { x: 8, y: 186 }, split0: { x: 372, y: 104 }, split1: { x: 372, y: 244 }, split2: { x: 372, y: 384 } },
    { window: { x: 0, y: 16 }, phone: { x: 452, y: 208 }, pass: { x: 12, y: 400, s: 0.5 } },
  ],
  connectors: [
    [
      elbow([290, 116], [333, 214], 322),
      elbow([290, 164], [333, 254], 312),
      elbow([290, 212], [333, 294], 302),
    ],
    [],
    [elbow([296, 132], [353, 116], 326), lPath([152, 216], [353, 338], "v")],
    [elbow([296, 255], [369, 130], 332), elbow([296, 270], [369, 270], 332), elbow([296, 285], [369, 410], 332)],
    [],
  ],
  drift: ["route", null, "refund", "split2", "phone"],
};

const MOBILE: Canvas = {
  w: 360,
  h: 540,
  size: {
    pass: { w: 256, h: 150 },
    balance: { w: 300, h: 208 },
    route: { w: 300, h: 64 },
    hold: { w: 260, h: 184 },
    refund: { w: 260, h: 76 },
    split0: { w: 220, h: 52 },
    split1: { w: 220, h: 52 },
    split2: { w: 220, h: 52 },
    window: { w: 336, h: 250 },
    phone: { w: 150, h: 270 },
  },
  scenes: [
    { pass: { x: 96, y: 250 }, balance: { x: 8, y: 8 }, route: { x: 30, y: 440 } },
    { pass: { x: 52, y: 195 } },
    { pass: { x: 8, y: 8, s: 0.85 }, hold: { x: 8, y: 170 }, refund: { x: 92, y: 400 } },
    { pass: { x: 52, y: 8 }, split0: { x: 100, y: 220 }, split1: { x: 100, y: 300 }, split2: { x: 100, y: 380 } },
    { window: { x: 0, y: 8 }, phone: { x: 196, y: 200 }, pass: { x: 8, y: 440, s: 0.5 } },
  ],
  connectors: [
    [lPath([308, 88], [340, 247], "h"), lPath([308, 136], [328, 247], "h"), lPath([308, 184], [316, 247], "h")],
    [],
    [lPath([140, 136], [140, 167], "v"), lPath([226, 60], [330, 397], "h")],
    [lPath([90, 158], [97, 246], "v"), lPath([80, 158], [97, 326], "v"), lPath([70, 158], [97, 406], "v")],
    [],
  ],
  drift: ["route", null, "refund", "split2", "phone"],
};

/** Where an element sits when it isn't part of the scene: folded into the pass on scene 2, else near its home. */
function hiddenTarget(c: Canvas, el: El, scene: number): Target {
  const pass = c.scenes[scene]!.pass!;
  const ps = pass.s ?? 1;
  const { w, h } = c.size[el];
  if (scene === 1) {
    return { x: pass.x + (c.size.pass.w * ps) / 2 - w / 4, y: pass.y + (c.size.pass.h * ps) / 2 - h / 4, s: 0.5 };
  }
  const home = c.scenes.find(s => s[el])?.[el] ?? { x: 0, y: 0 };
  return { x: home.x, y: home.y + 12, s: 0.96 };
}

const EASE = [0.22, 1, 0.36, 1] as const;

export function Stage({ scene }: { scene: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    setViewportH(window.innerHeight);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const canvas = width && width < 600 ? MOBILE : DESKTOP;
  // The stage shares one screen with the header (64px) and the section heading, so it scales to
  // whichever is tighter: its column's width or the height left in the viewport.
  const availH = viewportH ? viewportH - 64 - (width < 600 ? 170 : 150) : canvas.h;
  const scale = width ? Math.max(0.6, Math.min(1, width / canvas.w, availH / canvas.h)) : 1;
  const offsetX = width ? Math.max(0, (width - canvas.w * scale) / 2) : 0;
  const visible = canvas.scenes[scene] ?? canvas.scenes[0]!;
  const order = Object.keys(visible) as El[];

  return (
    <div
      ref={box}
      className="stage"
      id={STAGE_ID}
      role="tabpanel"
      aria-label={`Example: ${SCENE_NAMES[scene]}`}
      style={{ height: width ? canvas.h * scale : DESKTOP.h }}
    >
      {width > 0 && (
        <div
          className="stage-canvas"
          style={{ width: canvas.w, height: canvas.h, transform: `translateX(${offsetX}px) scale(${scale})` }}
          aria-hidden="true"
        >
          {ELEMENTS.map(el => {
            const shown = visible[el];
            const t = shown ?? hiddenTarget(canvas, el, scene);
            const index = order.indexOf(el);
            const { w, h } = canvas.size[el];
            return (
              <motion.div
                key={el}
                className={`stage-el stage-${el.replace(/\d/, "")}`}
                style={{ width: w, height: h, zIndex: el === "pass" ? 3 : el === "phone" ? 2 : 1 }}
                initial={false}
                animate={{ x: t.x, y: t.y, scale: t.s ?? 1, opacity: shown ? 1 : 0 }}
                transition={{ duration: 0.7, ease: EASE, delay: shown && el !== "pass" ? 0.08 * Math.max(0, index) : 0 }}
              >
                <Drift on={canvas.drift[scene] === el}>
                  <Fragment el={el} scene={scene} />
                </Drift>
              </motion.div>
            );
          })}
          <Connectors key={`${scene}-${canvas.w}`} list={canvas.connectors[scene] ?? []} w={canvas.w} h={canvas.h} />
        </div>
      )}
    </div>
  );
}

function Drift({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <motion.div
      className="stage-drift"
      animate={on ? { y: [0, -5, 0] } : { y: 0 }}
      transition={on ? { duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 } : { duration: 0.4 }}
    >
      {children}
    </motion.div>
  );
}

/** Dotted connectors that draw themselves: a solid stroke animates inside a mask over a dotted one. */
function Connectors({ list, w, h }: { list: Connector[]; w: number; h: number }) {
  const id = useId();
  return (
    <svg className="stage-lines" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {list.map((c, i) => {
        const mask = `${id}-m${i}`;
        const delay = 0.45 + i * 0.08;
        return (
          <g key={i}>
            <mask id={mask} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
              <motion.path
                d={c.d}
                stroke="#fff"
                strokeWidth={4}
                fill="none"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.6, ease: EASE, delay }}
              />
            </mask>
            <path d={c.d} className="stage-line" mask={`url(#${mask})`} />
            <motion.circle
              cx={c.start[0]}
              cy={c.start[1]}
              r={2.5}
              className="stage-dot"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay, duration: 0.2 }}
            />
            <motion.path
              d={chevron(c.end, c.dir)}
              className="stage-arrow"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: delay + 0.55, duration: 0.15 }}
            />
          </g>
        );
      })}
    </svg>
  );
}

// --- fragments ---------------------------------------------------------------------------

function Fragment({ el, scene }: { el: El; scene: number }) {
  switch (el) {
    case "pass":
      return <Pass flipped={scene === 1} />;
    case "balance":
      return (
        <div className="frag frag-balance">
          <p className="frag-title num">$31.40 available across 3 chains</p>
          {[
            ["Arbitrum", "usdc · arbitrum", "$12.00"],
            ["Base", "usdc · base", "$9.40"],
            ["Tron", "usdt · tron", "$10.00"],
          ].map(([name, chain, amount]) => (
            <div className="frag-row" key={name}>
              <span className="frag-row-label">
                {name}
                <span className="frag-mono">{chain}</span>
              </span>
              <span className="num">{amount}</span>
            </div>
          ))}
        </div>
      );
    case "route":
      return (
        <div className="frag frag-route">
          <span className="frag-pill">USDT on Tron</span>
          <span className="frag-dots" />
          <ArrowRight size={14} strokeWidth={1.5} className="frag-route-arrow" />
          <span className="frag-pill">USDC to merchant</span>
        </div>
      );
    case "hold":
      return (
        <div className="frag frag-hold">
          <p className="frag-title num">In escrow 40.00 USDC</p>
          <div className="frag-row">
            <span>Capture</span>
            <span>At check-in</span>
          </div>
          <div className="frag-row">
            <span>If cancelled</span>
            <span>Back to Tron</span>
          </div>
          <div className="frag-actions">
            <span className="btn btn-small">Capture</span>
            <span className="btn btn-outline btn-small">Refund to source</span>
          </div>
        </div>
      );
    case "refund":
      return (
        <div className="frag frag-refund">
          <span className="frag-icon">
            <RotateCcw size={16} strokeWidth={1.5} />
          </span>
          <span className="frag-stack">
            <span className="frag-title num">Refunded 40.00 USDT</span>
            <span className="frag-mono">usdt · tron</span>
          </span>
        </div>
      );
    case "split0":
    case "split1":
    case "split2": {
      const [who, pct, amount] = [
        ["Night Garden", "70%", "84.00"],
        ["Co-host", "20%", "24.00"],
        ["Venue", "10%", "12.00"],
      ][Number(el.slice(-1))]!;
      return (
        <div className="frag frag-split">
          <span>
            {who} <span className="muted">{pct}</span>
          </span>
          <span className="num frag-strong">{amount}</span>
        </div>
      );
    }
    case "window":
      return <Dashboard />;
    case "phone":
      return <Phone />;
  }
}

function MarkWhite({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <path
        d="M20 68 V22 L50 54 L80 22 V66 C80 84 66 90 48 90 H30"
        stroke="#FFFFFF"
        strokeWidth={11}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={18} cy={90} r={6.5} fill="#1DB36B" />
    </svg>
  );
}

function Pass({ flipped }: { flipped: boolean }) {
  return (
    <div className="pass-3d">
      <motion.div
        className="pass-flip"
        initial={false}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.7, ease: EASE, delay: flipped ? 0.35 : 0 }}
      >
        <div className="pass-face pass-front">
          <div className="pass-main">
            <div className="pass-brand">
              <MarkWhite />
              <span>morva</span>
            </div>
            <div className="pass-meta">
              <span>ADMIT ONE</span>
              <span>ORD-1042</span>
            </div>
          </div>
          <div className="pass-stub">
            <span className="pass-chain">usdt · tron</span>
          </div>
          <span className="pass-notch pass-notch-top" />
          <span className="pass-notch pass-notch-bottom" />
        </div>
        <div className="pass-face pass-back">
          <p className="frag-title">Received</p>
          <p className="pass-total num">
            <motion.span
              key={String(flipped)}
              initial={flipped ? { y: 14, opacity: 0 } : false}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.5, ease: EASE, delay: 1 }}
              style={{ display: "inline-block" }}
            >
              64.00
            </motion.span>{" "}
            USDC
          </p>
          <div className="frag-row">
            <span>Invoiced</span>
            <span className="num">64.00</span>
          </div>
          <div className="frag-row">
            <span>Short by</span>
            <span className="num">0.00</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

const ORDERS = [
  ["10:42", "Tron", "25.00", "Held"],
  ["10:39", "Base", "64.00", "Paid"],
  ["10:31", "Solana", "40.00", "Refunded"],
  ["10:24", "Arbitrum", "120.00", "Paid"],
  ["10:18", "Ethereum", "12.00", "Paid"],
];

function Dashboard() {
  return (
    <div className="frag frag-window">
      <div className="window-bar">
        <span className="window-title">
          <svg width={16} height={16} viewBox="0 0 100 100" fill="none" aria-hidden="true">
            <path d="M20 68 V22 L50 54 L80 22 V66 C80 84 66 90 48 90 H30" stroke="#0E1726" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={18} cy={90} r={6.5} fill="#1DB36B" />
          </svg>
          Orders
        </span>
        <span className="frag-mono">example store</span>
      </div>
      <div className="window-table">
        <div className="window-row window-head">
          <span>Time</span>
          <span>Paid from</span>
          <span className="num">USDC</span>
          <span>Status</span>
        </div>
        {ORDERS.map(([time, chain, amount, status]) => (
          <div className="window-row" key={time}>
            <span className="muted window-time">{time}</span>
            <span>{chain}</span>
            <span className="num">{amount}</span>
            <span className={status === "Paid" ? "status-success" : "muted"}>{status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Phone() {
  return (
    <div className="frag frag-phone">
      <span className="phone-notch" />
      <p className="frag-mono">Northside Events</p>
      <p className="phone-total num">$25.00</p>
      <p className="phone-line">From 3 chains</p>
      <div className="phone-rows">
        <span>Arbitrum</span>
        <span>Base</span>
        <span>Tron</span>
      </div>
      <span className="btn btn-accent btn-small btn-block">Pay $25.00</span>
    </div>
  );
}
