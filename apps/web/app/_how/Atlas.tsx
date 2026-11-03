"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { motion, useMotionValue, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { Check, Copy, RotateCcw } from "lucide-react";
import { Mark, PanelBody } from "./panels";
import { DESKTOP, MOBILE, PANEL_W, regionWidth, roundedPath, type AtlasLayout, type AtlasPanel, type Pt, type RegionId } from "./atlas-layout";

// "How it works" as a scroll-driven atlas. The whole payment system is one large map; scroll
// moves a camera from region to region while the Morva order travels along the route.
// Everything is derived from one scroll value, so scrubbing in either direction is exact.

export interface Step {
  title: string;
  body: string;
}

type Range = [number, number];
const RAMP = 0.02;

/** 1 inside any of the ranges, `rest` outside, with short linear ramps at the edges. */
function windowed(v: number, ranges: Range[], rest: number, rampW = RAMP): number {
  let best = 0;
  for (const [a, b] of ranges) {
    const up = Math.min(1, Math.max(0, (v - a) / rampW + 1));
    const down = Math.min(1, Math.max(0, (b - v) / rampW + 1));
    best = Math.max(best, Math.min(up, down));
  }
  return rest + (1 - rest) * best;
}
const ramp = (v: number, a: number, b: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const REST = 0.35;
const END: Range = [0.94, 1.1];

// When each panel is lit. Polygon never lights: it is too small to move.
const LIT: Record<AtlasPanel, Range[]> = {
  link: [[0.14, 0.34], END],
  ledger: [[0.2, 0.34], [0.84, 0.92], END],
  webhook: [[0.22, 0.34], END],
  payout: [[0.84, 0.92], END],
  walletBase: [[0.38, 0.54], END],
  walletArb: [[0.4, 0.54], END],
  walletOp: [[0.42, 0.54], END],
  walletPoly: [],
  deposit: [[0.45, 0.54], END],
  sign: [[0.47, 0.56], END],
  quote: [[0.56, 0.74], END],
  solvers: [[0.59, 0.74], END],
  balance: [[0.62, 0.74], END],
  escrow: [[0.76, 0.88], END],
  capture: [[0.82, 0.88], END],
  refundSource: [[0.9, 1.1]],
};
const REGION_LIT: Record<RegionId, Range[]> = {
  merchant: [[0.14, 0.34], [0.84, 0.92], END],
  wallets: [[0.36, 0.54], END],
  near: [[0.56, 0.74], END],
  escrow: [[0.74, 0.9], END],
};
const CAPTION: Range[] = [
  [0.08, 0.34],
  [0.34, 0.54],
  [0.54, 0.74],
  [0.74, 1.1],
];
const CARD_STATES: { text: React.ReactNode; range: Range }[] = [
  { text: "Link ready", range: [0.08, 0.34] },
  { text: "$27.50 across 3 chains", range: [0.34, 0.47] },
  { text: "Signed once", range: [0.47, 0.56] },
  { text: "Routing", range: [0.56, 0.66] },
  {
    text: (
      <>
        Received 25.00 USDC <span className="w-ok">exact</span>
      </>
    ),
    range: [0.66, 0.78],
  },
  { text: "Held in escrow", range: [0.78, 0.83] },
  {
    text: (
      <span className="w-ok">
        <Check size={14} strokeWidth={1.5} /> Captured, paid out
      </span>
    ),
    range: [0.83, 1.1],
  },
];

// Camera keyframes. `card` is the anchor the order card sits at; `dip` zooms out mid-flight.
type CamTarget = "wide" | RegionId | "return";
const KEYS: { p: number; cam: CamTarget; card: number; dip?: boolean }[] = [
  { p: 0, cam: "wide", card: 0 },
  { p: 0.1, cam: "wide", card: 0 },
  { p: 0.24, cam: "merchant", card: 0 },
  { p: 0.3, cam: "merchant", card: 0 },
  { p: 0.44, cam: "wallets", card: 1, dip: true },
  { p: 0.5, cam: "wallets", card: 1 },
  { p: 0.64, cam: "near", card: 2, dip: true },
  { p: 0.7, cam: "near", card: 2 },
  { p: 0.78, cam: "escrow", card: 3, dip: true },
  { p: 0.82, cam: "escrow", card: 3 },
  { p: 0.88, cam: "return", card: 4 },
  { p: 0.96, cam: "wide", card: 4 },
  { p: 1, cam: "wide", card: 4 },
];

interface Scene {
  cx: number;
  cy: number;
  s: number;
  tx: number;
  ty: number;
  len: number;
}

interface Measure {
  vw: number;
  vh: number;
  wide: number;
  focus: number;
  anchorLen: number[];
  total: number;
}

function sceneAt(p: number, layout: AtlasLayout, m: Measure): Scene {
  const v = Math.min(1, Math.max(0, p));
  let i = 0;
  while (i < KEYS.length - 2 && v > KEYS[i + 1]!.p) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = b.p === a.p ? 1 : (v - a.p) / (b.p - a.p);
  const e = ease(t);
  const cam = (k: CamTarget): [number, number, number] => {
    if (k === "wide") return [layout.w / 2, layout.h / 2, m.wide];
    if (k === "return") return [layout.focus.return[0], layout.focus.return[1], Math.max(m.wide, layout.returnScale * m.focus)];
    return [layout.focus[k][0], layout.focus[k][1], m.focus];
  };
  const [ax, ay, as] = cam(a.cam);
  const [bx, by, bs] = cam(b.cam);
  const cx = ax + (bx - ax) * e;
  const cy = ay + (by - ay) * e;
  // Scale moves geometrically; a flight between two stops also dips out a little mid-way.
  const s = as * Math.pow(bs / as, e) * (b.dip ? 1 - 0.22 * Math.sin(Math.PI * t) : 1);
  const la = m.anchorLen[a.card] ?? 0;
  const lb = m.anchorLen[b.card] ?? 0;
  return { cx, cy, s, tx: m.vw / 2 - cx * s, ty: m.vh / 2 - cy * s, len: la + (lb - la) * e };
}

function useMedia(query: string, server: boolean) {
  return useSyncExternalStore(
    notify => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => server,
  );
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function Atlas({ steps, subline }: { steps: Step[]; subline: string }) {
  const reduced = useReducedMotion();
  const mobile = useMedia("(max-width: 719px)", false);
  const layout = mobile ? MOBILE : DESKTOP;
  return reduced ? (
    <StaticAtlas steps={steps} subline={subline} layout={layout} />
  ) : (
    <ScrollAtlas steps={steps} subline={subline} layout={layout} mobile={mobile} />
  );
}

// --- the scroll-driven version -------------------------------------------------------------

function ScrollAtlas({ steps, subline, layout, mobile }: { steps: Step[]; subline: string; layout: AtlasLayout; mobile: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const route = useRef<SVGPathElement>(null);
  const measure = useRef<Measure>({ vw: 1440, vh: 736, wide: 0.35, focus: 1, anchorLen: [0, 0, 0, 0, 0], total: 1 });

  const { scrollYProgress: p } = useScroll({ target: container, offset: ["start start", "end end"] });
  const scene = useTransform(p, v => sceneAt(v, layout, measure.current));

  // Viewport and route are measured on resize only; a fresh scene is pushed afterwards.
  useIsoLayoutEffect(() => {
    const f = frame.current;
    const path = route.current;
    if (!f || !path) return;
    const update = () => {
      const vw = f.clientWidth;
      const vh = f.clientHeight;
      const total = path.getTotalLength();
      // Each anchor's distance along the route: the nearest of a few hundred samples.
      const samples = Array.from({ length: 600 }, (_, i) => {
        const l = (total * i) / 599;
        const pt = path.getPointAtLength(l);
        return { l, x: pt.x, y: pt.y };
      });
      const anchorLen = layout.anchors.map(([ax, ay], k) => {
        if (k === layout.anchors.length - 1) return total;
        let best = samples[0]!;
        for (const s of samples) if (Math.hypot(s.x - ax, s.y - ay) < Math.hypot(best.x - ax, best.y - ay)) best = s;
        return best.l;
      });
      const wide = Math.min(vw / (layout.w + 160), vh / (layout.h + 260));
      const focus = mobile ? vw / 560 : Math.min(1, vw / 1300);
      measure.current = { vw, vh, wide, focus, anchorLen, total };
      scene.set(sceneAt(p.get(), layout, measure.current));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(f);
    return () => ro.disconnect();
  }, [layout, mobile, p, scene]);

  const camera = useTransform(scene, s => `translate3d(${s.tx}px, ${s.ty}px, 0) scale(${s.s})`);
  const drawn = useTransform(scene, s => s.len / measure.current.total);
  const refundDrawn = useTransform(p, v => ramp(v, 0.88, 0.97));

  const pointOn = (len: number): Pt => {
    const path = route.current;
    if (!path) return layout.anchors[0]!;
    const pt = path.getPointAtLength(len);
    return [pt.x, pt.y];
  };
  const cardX = useTransform(scene, s => pointOn(s.len)[0] * s.s + s.tx);
  const cardY = useTransform(scene, s => pointOn(s.len)[1] * s.s + s.ty);
  const cardOpacity = useTransform(p, v => ramp(v, 0.09, 0.13));

  const refundMid = layout.refund[2]!;
  const ghostX = useTransform(scene, s => refundMid[0] * s.s + s.tx);
  const ghostY = useTransform(scene, s => refundMid[1] * s.s + s.ty);
  const ghostOpacity = useTransform(p, v => 0.8 * ramp(v, 0.93, 0.97));

  const headOpacity = useTransform(p, v => 1 - ramp(v, 0.07, 0.11));
  const headY = useTransform(p, v => -16 * ramp(v, 0.07, 0.11));
  const smallOpacity = useTransform(p, v => ramp(v, 0.1, 0.13));

  // Mini-map: the camera's centre as a dot.
  const dotX = useTransform(scene, s => s.cx);
  const dotY = useTransform(scene, s => s.cy);

  return (
    <div ref={container} className="atlas-scroll">
      <div ref={frame} className="atlas-frame">
        <motion.div className="atlas c-dots-bg" style={{ width: layout.w, height: layout.h, transform: camera }} aria-hidden="true">
          <AtlasMap layout={layout} p={p} routeRef={route} drawn={drawn} refundDrawn={refundDrawn} />
        </motion.div>

        <motion.div className="atlas-head" style={{ opacity: headOpacity, y: headY }}>
          <h2 id="how-title" className="section-title">
            How it works
          </h2>
          <p className="section-lead">{subline}</p>
        </motion.div>
        <motion.p className="atlas-small" style={{ opacity: smallOpacity }} aria-hidden="true">
          How it works
        </motion.p>

        <motion.div className="atlas-card" style={{ x: cardX, y: cardY, opacity: cardOpacity }} aria-hidden="true">
          <Traveller p={p} />
        </motion.div>
        <motion.div className="atlas-card atlas-ghost" style={{ x: ghostX, y: ghostY, opacity: ghostOpacity }} aria-hidden="true">
          <div className="t-card">
            <p className="t-state">
              <RotateCcw size={14} strokeWidth={1.5} /> Refunded to source
            </p>
          </div>
        </motion.div>

        <div className="atlas-caption">
          {steps.map((s, i) => (
            <Caption key={s.title} p={p} range={CAPTION[i]!} index={i} count={steps.length} step={s} />
          ))}
        </div>

        {!mobile && (
          <svg className="atlas-minimap" viewBox={`0 0 ${layout.w} ${layout.h}`} aria-hidden="true">
            {layout.regions.map(r => (
              <rect key={r.id} x={r.x} y={r.y} width={regionWidth(r)} height={rowsHeight(r)} rx={40} className="mm-region" />
            ))}
            <path d={roundedPath(layout.route)} className="mm-route-base" />
            <motion.path d={roundedPath(layout.route)} className="mm-route" style={{ pathLength: drawn }} />
            <motion.circle cx={0} cy={0} r={60} className="mm-dot" style={{ x: dotX, y: dotY }} />
          </svg>
        )}
      </div>
    </div>
  );
}

function rowsHeight(r: { panels: unknown[]; cols: number }) {
  return Math.ceil(r.panels.length / r.cols) * 140;
}

function Caption({ p, range, index, count, step }: { p: MotionValue<number>; range: Range; index: number; count: number; step: Step }) {
  const opacity = useTransform(p, v => windowed(v, [[range[0] + 0.012, range[1] - 0.012]], 0, 0.012));
  const y = useTransform(opacity, o => (1 - o) * 8);
  return (
    <motion.div className="atlas-caption-item" style={{ opacity, y }}>
      <p className="atlas-count num">
        {index + 1} / {count}
      </p>
      <h3 className="atlas-step">{step.title}</h3>
      <p className="atlas-body">{step.body}</p>
    </motion.div>
  );
}

function Traveller({ p }: { p: MotionValue<number> }) {
  return (
    <div className="t-card">
      <div className="t-head">
        <span className="o-brand">
          <Mark /> Order
        </span>
        <span className="w-mono">MRV-1042</span>
      </div>
      <p className="w-muted t-item">Northside Events · Builders’ night ticket</p>
      <p className="t-total num">$25.00</p>
      <div className="t-states">
        {CARD_STATES.map((c, i) => (
          <StateLine key={i} p={p} range={c.range}>
            {c.text}
          </StateLine>
        ))}
      </div>
    </div>
  );
}

function StateLine({ p, range, children }: { p: MotionValue<number>; range: Range; children: React.ReactNode }) {
  // A short fade inside the window, so neighbouring states never show at the same time.
  const opacity = useTransform(p, v => windowed(v, [[range[0] + 0.006, range[1] - 0.006]], 0, 0.006));
  return (
    <motion.p className="t-state" style={{ opacity }}>
      {children}
    </motion.p>
  );
}

// --- the map itself (shared by the scroll and static versions) ----------------------------

function AtlasMap({
  layout,
  p,
  routeRef,
  drawn,
  refundDrawn,
}: {
  layout: AtlasLayout;
  p: MotionValue<number>;
  routeRef?: React.RefObject<SVGPathElement | null>;
  drawn: MotionValue<number>;
  refundDrawn: MotionValue<number>;
}) {
  const routeD = roundedPath(layout.route);
  const refundD = roundedPath(layout.refund, 40);
  const labelAt = layout.refund[3]!;
  return (
    <>
      <svg className="atlas-lines" width={layout.w} height={layout.h} viewBox={`0 0 ${layout.w} ${layout.h}`}>
        <path d={routeD} className="atlas-route-base" />
        <motion.path ref={routeRef} d={routeD} className="atlas-route" style={{ pathLength: drawn }} />
        <motion.path d={refundD} className="atlas-refund" style={{ pathLength: refundDrawn }} />
        <motion.text
          x={labelAt[0] + 18}
          y={(labelAt[1] + layout.refund[2]![1]) / 2}
          className="atlas-refund-label"
          style={{ opacity: refundDrawn }}
        >
          refund to source
        </motion.text>
      </svg>
      {layout.regions.map(r => (
        <RegionView key={r.id} region={r} p={p} />
      ))}
    </>
  );
}

function RegionView({ region, p }: { region: AtlasLayout["regions"][number]; p: MotionValue<number> }) {
  const labelOpacity = useTransform(p, v => windowed(v, REGION_LIT[region.id], REST));
  return (
    <div className="atlas-region" style={{ left: region.x, top: region.y, width: regionWidth(region) }}>
      <motion.p className="atlas-region-label" style={{ opacity: labelOpacity }}>
        {region.label}
      </motion.p>
      <div className="atlas-panels" style={{ gridTemplateColumns: `repeat(${region.cols}, ${PANEL_W}px)` }}>
        {region.panels.map(id => (
          <AtlasPanelView key={id} id={id} p={p} />
        ))}
      </div>
    </div>
  );
}

function AtlasPanelView({ id, p }: { id: AtlasPanel; p: MotionValue<number> }) {
  const opacity = useTransform(p, v => windowed(v, LIT[id], REST));
  return (
    <motion.div className="w-panel" style={{ opacity }}>
      <AtlasPanelBody id={id} p={p} />
    </motion.div>
  );
}

function AtlasPanelBody({ id, p }: { id: AtlasPanel; p: MotionValue<number> }) {
  const filled = useTransform(p, v => ramp(v, 0.62, 0.64));
  const bid = useTransform(filled, f => 1 - f);
  const balance = useTransform(p, v => (25.25 * ramp(v, 0.62, 0.7)).toFixed(2));
  switch (id) {
    case "link":
      return (
        <>
          <p className="w-label">Payment link</p>
          <div className="w-deposit">
            <MiniQr />
            <span className="w-link-text">
              <span className="w-mono">pay.morva.xyz/nse-25</span>
              <Copy size={13} strokeWidth={1.5} />
            </span>
          </div>
        </>
      );
    case "walletOp":
      return (
        <>
          <p className="w-label">Wallet · Optimism</p>
          <div className="w-row">
            <span>USDC</span>
            <span className="num w-strong">6.00</span>
          </div>
        </>
      );
    case "walletPoly":
      return (
        <>
          <p className="w-label">Wallet · Polygon</p>
          <div className="w-row">
            <span>USDC</span>
            <span className="num w-strong">0.30</span>
          </div>
          <p className="w-muted">too small to move</p>
        </>
      );
    case "solvers":
      return (
        <>
          <p className="w-label">Solvers</p>
          {["Solver A", "Solver B", "Solver C"].map((s, i) => (
            <div className="w-row" key={s}>
              <span>{s}</span>
              <span className="w-bid">
                <motion.span className="w-muted" style={{ opacity: i === 1 ? bid : 1 }}>
                  bid
                </motion.span>
                {i === 1 && (
                  <motion.span className="w-ok" style={{ opacity: filled }}>
                    <Check size={12} strokeWidth={1.5} /> filled
                  </motion.span>
                )}
              </span>
            </div>
          ))}
        </>
      );
    case "balance":
      return (
        <>
          <p className="w-label">Your NEAR Intents balance</p>
          <p className="w-big num">
            $<motion.span>{balance}</motion.span>
          </p>
          <p className="w-muted">Arbitrum · Base · Optimism</p>
        </>
      );
    case "capture":
      return (
        <>
          <p className="w-label">Capture</p>
          <span className="w-btn">Capture 25.00</span>
          <p className="w-muted">Pays out to the merchant</p>
        </>
      );
    case "refundSource":
      return (
        <>
          <p className="w-label">Refund to source</p>
          <span className="w-btn w-btn-outline">Refund to source</span>
          <p className="w-muted">Back to USDC on Optimism</p>
        </>
      );
    default:
      return <PanelBody id={id} lit={false} branch="capture" />;
  }
}

function MiniQr() {
  return (
    <span className="w-qr" style={{ gridTemplateColumns: "repeat(7, 1fr)" }} aria-hidden="true">
      {Array.from({ length: 49 }, (_, i) => (
        <span key={i} style={{ opacity: (i * 29 + (i % 7) * 7) % 5 < 2 ? 1 : 0 }} />
      ))}
    </span>
  );
}

// --- reduced motion: the finished map as a still, then the steps as text -------------------

function StaticAtlas({ steps, subline, layout }: { steps: Step[]; subline: string; layout: AtlasLayout }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const done = useMotionValue(1);
  const scale = width / layout.w;
  const end = layout.anchors[layout.anchors.length - 1]!;
  const ghost = layout.refund[2]!;
  return (
    <div className="section">
      <div className="container">
        <div className="section-head">
          <h2 id="how-title" className="section-title">
            How it works
          </h2>
          <p className="section-lead">{subline}</p>
        </div>
        <div ref={box} className="atlas-still" style={{ height: layout.h * scale }} aria-hidden="true">
          {width > 0 && (
            <>
              <div className="atlas c-dots-bg" style={{ width: layout.w, height: layout.h, transform: `scale(${scale})` }}>
                <AtlasMap layout={layout} p={done} drawn={done} refundDrawn={done} />
              </div>
              <div className="atlas-card" style={{ transform: `translate(${end[0] * scale}px, ${end[1] * scale}px)` }}>
                <div className="t-card">
                  <p className="t-state w-ok">
                    <Check size={14} strokeWidth={1.5} /> Captured, paid out
                  </p>
                </div>
              </div>
              <div className="atlas-card atlas-ghost" style={{ transform: `translate(${ghost[0] * scale}px, ${ghost[1] * scale}px)` }}>
                <div className="t-card">
                  <p className="t-state">
                    <RotateCcw size={14} strokeWidth={1.5} /> Refunded to source
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
        <ol className="atlas-steps">
          {steps.map((s, i) => (
            <li key={s.title}>
              <p className="atlas-count num">
                {i + 1} / {steps.length}
              </p>
              <h3 className="atlas-step">{s.title}</h3>
              <p className="atlas-body">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
