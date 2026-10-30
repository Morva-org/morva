"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { MorvaMark } from "../MorvaMark";
import { SOURCES, chevron, type ChipId, type DiagramLayout, type EdgeId } from "./geometry";

interface Step {
  active?: ChipId[];
  success?: ChipId[];
  draw?: EdgeId[];
  ms: number;
}

const HOP = 600;
const HOLD = 1200;
const FADE = 400;

// 1: unified balance. 2: single payment. 3: refund to source, back through the hub.
const SCENES: Step[][] = [
  [
    { active: ["arb", "eth", "tron"], draw: ["arb-hub", "eth-hub", "tron-hub"], ms: HOP },
    { active: ["hub"], draw: ["hub-merchant"], ms: HOP },
    { success: ["merchant"], ms: HOLD },
  ],
  [
    { active: ["sol"], draw: ["sol-hub"], ms: HOP },
    { active: ["hub"], draw: ["hub-merchant"], ms: HOP },
    { success: ["merchant"], ms: HOLD },
  ],
  [
    { active: ["merchant"], draw: ["merchant-hub"], ms: HOP },
    { active: ["hub"], draw: ["hub-tron"], ms: HOP },
    { success: ["tron"], ms: HOLD },
  ],
];

const BASE_EDGES: EdgeId[] = ["arb-hub", "eth-hub", "tron-hub", "sol-hub", "base-hub", "hub-merchant"];

export const DIAGRAM_LABEL =
  "Diagram: USDC on Arbitrum, ETH on Ethereum, USDT on Tron, SOL on Solana and USDC on Base each route into one balance, " +
  "which pays the merchant in USDC. Refunds travel back the same way to the chain the buyer paid from.";

/** "loop" plays the scenes, "static" shows scene 1 fully drawn, "idle" shows the neutral diagram. */
export type DiagramMode = "loop" | "static" | "idle";

export function RoutingDiagram({
  layout,
  mode,
  playing = true,
  othersOpacity,
  hubContentOpacity,
}: {
  layout: DiagramLayout;
  mode: DiagramMode;
  playing?: boolean;
  othersOpacity?: import("framer-motion").MotionValue<number>;
  hubContentOpacity?: import("framer-motion").MotionValue<number>;
}) {
  const [pos, setPos] = useState({ scene: 0, step: 0, fading: false });

  useEffect(() => {
    if (mode !== "loop") setPos({ scene: 0, step: 0, fading: false });
  }, [mode]);

  useEffect(() => {
    if (mode !== "loop" || !playing) return;
    const steps = SCENES[pos.scene]!;
    const ms = pos.fading ? FADE : steps[pos.step]!.ms;
    const t = window.setTimeout(() => {
      setPos(p => {
        if (p.fading) return { scene: (p.scene + 1) % SCENES.length, step: 0, fading: false };
        if (p.step < steps.length - 1) return { ...p, step: p.step + 1 };
        return { ...p, fading: true };
      });
    }, ms);
    return () => window.clearTimeout(t);
  }, [mode, playing, pos]);

  const shown =
    mode === "idle" ? [] : mode === "static" ? SCENES[0]! : SCENES[pos.scene]!.slice(0, pos.step + 1);
  const success = new Set(shown.flatMap(s => s.success ?? []));
  const active = new Set(shown.flatMap(s => s.active ?? []).filter(id => !success.has(id)));
  const drawn = shown.flatMap(s => s.draw ?? []);
  const fading = mode === "loop" && pos.fading;
  const animate = mode === "loop";
  const sceneKey = mode === "loop" ? pos.scene : -1;

  const { boxes, edges } = layout;

  return (
    <div className="diagram" style={{ height: layout.height }} role="img" aria-label={DIAGRAM_LABEL}>
      <motion.svg
        className="diagram-lines"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        aria-hidden="true"
        style={{ opacity: othersOpacity }}
      >
        {BASE_EDGES.map(id => {
          const e = edges[id];
          return (
            <g key={id}>
              <path d={e.d} className="line-base" />
              <circle cx={e.start[0]} cy={e.start[1]} r={2.5} className="line-dot" />
              <path d={chevron(e.end, e.dir)} className="line-base" />
            </g>
          );
        })}
        <motion.g animate={{ opacity: fading ? 0 : 1 }} transition={{ duration: FADE / 1000 }}>
          {drawn.map(id => {
            const e = edges[id];
            return (
              <g key={`${sceneKey}-${id}`}>
                <motion.path
                  d={e.d}
                  className="line-live"
                  initial={animate ? { pathLength: 0 } : false}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: HOP / 1000, ease: "easeInOut" }}
                />
                <motion.path
                  d={chevron(e.end, e.dir)}
                  className="line-live"
                  initial={animate ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  transition={{ delay: animate ? (HOP / 1000) * 0.85 : 0, duration: 0.1 }}
                />
              </g>
            );
          })}
        </motion.g>
      </motion.svg>

      {SOURCES.map(s => (
        <Chip key={s.id} box={boxes[s.id]} state={stateOf(s.id, active, success)} fading={fading} opacity={othersOpacity}>
          <span className="chip-currency">{s.currency}</span>
          <span className="chip-chain">{s.chain}</span>
        </Chip>
      ))}
      <Chip box={boxes.hub} state={stateOf("hub", active, success)} fading={fading} hub contentOpacity={hubContentOpacity}>
        <span className="chip-hub">
          <MorvaMark size={26} />
          <span className="chip-chain">your balance</span>
        </span>
      </Chip>
      <Chip box={boxes.merchant} state={stateOf("merchant", active, success)} fading={fading} opacity={othersOpacity}>
        <span className="chip-currency">USDC</span>
        <span className="chip-chain">merchant</span>
      </Chip>
    </div>
  );
}

type ChipState = "idle" | "active" | "success";

function stateOf(id: ChipId, active: Set<ChipId>, success: Set<ChipId>): ChipState {
  return success.has(id) ? "success" : active.has(id) ? "active" : "idle";
}

/** Fills are separate layers whose opacity changes, so state changes animate opacity only. */
function Chip({
  box,
  state,
  fading,
  hub,
  opacity,
  contentOpacity,
  children,
}: {
  box: { x: number; y: number; w: number; h: number };
  state: ChipState;
  fading: boolean;
  hub?: boolean;
  opacity?: import("framer-motion").MotionValue<number>;
  contentOpacity?: import("framer-motion").MotionValue<number>;
  children: React.ReactNode;
}) {
  const t = { duration: fading ? FADE / 1000 : 0.2 };
  return (
    <motion.div
      className={hub ? "chip chip-hub-box" : "chip"}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, opacity }}
      aria-hidden="true"
    >
      <motion.div className="chip-layer" style={{ opacity: contentOpacity }}>
        {children}
      </motion.div>
      <motion.div
        className="chip-layer chip-fill-active"
        initial={false}
        animate={{ opacity: state === "active" && !fading ? 1 : 0 }}
        transition={t}
      >
        {children}
      </motion.div>
      <motion.div
        className="chip-layer chip-fill-success"
        initial={false}
        animate={{ opacity: state === "success" && !fading ? 1 : 0 }}
        transition={t}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
