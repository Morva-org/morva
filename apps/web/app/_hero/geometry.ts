// Geometry for the routing diagram. Chip boxes come from the container width, and every
// connector is derived from those boxes, so the drawing is correct at any width.

export type ChipId = "arb" | "eth" | "tron" | "sol" | "base" | "hub" | "merchant";
export type EdgeId =
  | "arb-hub"
  | "eth-hub"
  | "tron-hub"
  | "sol-hub"
  | "base-hub"
  | "hub-merchant"
  | "merchant-hub"
  | "hub-tron";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Point = [number, number];
export type Dir = "right" | "left" | "down" | "up";

export interface Edge {
  d: string;
  start: Point;
  end: Point;
  dir: Dir;
}

export interface DiagramLayout {
  mode: "row" | "column";
  width: number;
  height: number;
  boxes: Record<ChipId, Box>;
  edges: Record<EdgeId, Edge>;
}

export const SOURCES: { id: Exclude<ChipId, "hub" | "merchant">; currency: string; chain: string }[] = [
  { id: "arb", currency: "USDC", chain: "arbitrum" },
  { id: "eth", currency: "ETH", chain: "ethereum" },
  { id: "tron", currency: "USDT", chain: "tron" },
  { id: "sol", currency: "SOL", chain: "solana" },
  { id: "base", currency: "USDC", chain: "base" },
];

export const COLUMN_BREAKPOINT = 640;
const ELBOW = 10;
const GAP = 3; // space between an arrowhead and the chip it points at

const cx = (b: Box) => b.x + b.w / 2;
const cy = (b: Box) => b.y + b.h / 2;
const sign = (n: number) => (n < 0 ? -1 : 1);

/** Orthogonal path a → b with one jog at `mid` along `axis`, elbows rounded. */
export function elbowPath(a: Point, b: Point, axis: "x" | "y", mid: number): string {
  const [ax, ay] = a;
  const [bx, by] = b;
  if (axis === "x") {
    if (Math.abs(by - ay) < 0.5) return `M${ax} ${ay}H${bx}`;
    const r = Math.min(ELBOW, Math.abs(by - ay) / 2, Math.abs(mid - ax), Math.abs(bx - mid));
    const s1 = sign(mid - ax);
    const s2 = sign(by - ay);
    const s3 = sign(bx - mid);
    return `M${ax} ${ay}H${mid - s1 * r}Q${mid} ${ay} ${mid} ${ay + s2 * r}V${by - s2 * r}Q${mid} ${by} ${mid + s3 * r} ${by}H${bx}`;
  }
  if (Math.abs(bx - ax) < 0.5) return `M${ax} ${ay}V${by}`;
  const r = Math.min(ELBOW, Math.abs(bx - ax) / 2, Math.abs(mid - ay), Math.abs(by - mid));
  const s1 = sign(mid - ay);
  const s2 = sign(bx - ax);
  const s3 = sign(by - mid);
  return `M${ax} ${ay}V${mid - s1 * r}Q${ax} ${mid} ${ax + s2 * r} ${mid}H${bx - s2 * r}Q${bx} ${mid} ${bx} ${mid + s3 * r}V${by}`;
}

function edge(a: Point, b: Point, axis: "x" | "y", mid: number): Edge {
  const last = axis === "x" ? b[0] - (Math.abs(b[1] - a[1]) < 0.5 ? a[0] : mid) : b[1] - (Math.abs(b[0] - a[0]) < 0.5 ? a[1] : mid);
  const dir: Dir = axis === "x" ? (last >= 0 ? "right" : "left") : last >= 0 ? "down" : "up";
  return { d: elbowPath(a, b, axis, mid), start: a, end: b, dir };
}

export function computeLayout(width: number): DiagramLayout {
  return width < COLUMN_BREAKPOINT ? columnLayout(width) : rowLayout(width);
}

function rowLayout(width: number): DiagramLayout {
  const chipW = 128;
  const chipH = 50;
  const gap = 10;
  const hubW = 168;
  const hubH = 76;
  const mW = 148;
  const colGap = Math.max(56, Math.min(150, (width - chipW - hubW - mW) / 2));
  const total = chipW + hubW + mW + 2 * colGap;
  const x0 = Math.max(0, (width - total) / 2);
  const height = SOURCES.length * chipH + (SOURCES.length - 1) * gap;

  const boxes = {} as Record<ChipId, Box>;
  SOURCES.forEach((s, i) => (boxes[s.id] = { x: x0, y: i * (chipH + gap), w: chipW, h: chipH }));
  const hub = (boxes.hub = { x: x0 + chipW + colGap, y: height / 2 - hubH / 2, w: hubW, h: hubH });
  const merchant = (boxes.merchant = { x: hub.x + hubW + colGap, y: height / 2 - chipH / 2, w: mW, h: chipH });

  const centre = (SOURCES.length - 1) / 2;
  // Outer sources turn later than inner ones, so vertical runs never overlap or cross.
  const midFor = (i: number) => x0 + chipW + colGap / 2 + (Math.abs(i - centre) - 1) * 12;
  // Spread arrivals along the hub's left edge so arrowheads don't stack.
  const entryY = (i: number) => cy(hub) + (i - centre) * 14;
  const edges = {} as Record<EdgeId, Edge>;
  SOURCES.forEach((s, i) => {
    const src = boxes[s.id];
    edges[`${s.id}-hub` as EdgeId] = edge([src.x + src.w, cy(src)], [hub.x - GAP, entryY(i)], "x", midFor(i));
  });
  edges["hub-merchant"] = edge([hub.x + hub.w, cy(hub)], [merchant.x - GAP, cy(merchant)], "x", (hub.x + hub.w + merchant.x) / 2);
  edges["merchant-hub"] = edge([merchant.x, cy(merchant)], [hub.x + hub.w + GAP, cy(hub)], "x", (hub.x + hub.w + merchant.x) / 2);
  const tron = boxes.tron;
  const tronIndex = SOURCES.findIndex(s => s.id === "tron");
  edges["hub-tron"] = edge([hub.x, entryY(tronIndex)], [tron.x + tron.w + GAP, cy(tron)], "x", midFor(tronIndex));

  return { mode: "row", width, height, boxes, edges };
}

function columnLayout(width: number): DiagramLayout {
  const gap = 10;
  const chipH = 52;
  const w = Math.min(118, (width - 2 * gap) / 3);
  const w2 = w - 16; // second-row chips are narrower so first-row lines pass beside them
  const rowW = 3 * w + 2 * gap;
  const x0 = (width - rowW) / 2;
  const c = [0, 1, 2].map(i => x0 + i * (w + gap) + w / 2);
  const y2 = chipH + 18;
  const bus = y2 + chipH + 18;
  const hubW = Math.min(184, width - 32);
  const hubH = 64;
  const mW = 168;

  const boxes = {} as Record<ChipId, Box>;
  const row1: ChipId[] = ["arb", "eth", "tron"];
  row1.forEach((id, i) => (boxes[id] = { x: c[i]! - w / 2, y: 0, w, h: chipH }));
  boxes.sol = { x: (c[0]! + c[1]!) / 2 - w2 / 2, y: y2, w: w2, h: chipH };
  boxes.base = { x: (c[1]! + c[2]!) / 2 - w2 / 2, y: y2, w: w2, h: chipH };
  const hub = (boxes.hub = { x: width / 2 - hubW / 2, y: bus + 30, w: hubW, h: hubH });
  const merchant = (boxes.merchant = { x: width / 2 - mW / 2, y: hub.y + hubH + 44, w: mW, h: chipH });
  const height = merchant.y + chipH;

  // Arrivals spread along the hub's top edge in left-to-right order, so lines never cross.
  const order = (["arb", "sol", "eth", "base", "tron"] as const).slice();
  const rank = (id: ChipId) => order.indexOf(id as (typeof order)[number]);
  const entryX = (id: ChipId) => cx(hub) + (rank(id) - 2) * 14;
  // Outer sources turn lower than inner ones, so horizontal runs never overlap or cross.
  const busFor = (id: ChipId) => bus + (Math.abs(rank(id) - 2) - 1) * 10;
  const edges = {} as Record<EdgeId, Edge>;
  for (const s of SOURCES) {
    const src = boxes[s.id];
    edges[`${s.id}-hub` as EdgeId] = edge([cx(src), src.y + src.h], [entryX(s.id), hub.y - GAP], "y", busFor(s.id));
  }
  edges["hub-merchant"] = edge([cx(hub), hub.y + hub.h], [cx(merchant), merchant.y - GAP], "y", 0);
  edges["merchant-hub"] = edge([cx(merchant), merchant.y], [cx(hub), hub.y + hub.h + GAP], "y", 0);
  const tron = boxes.tron;
  edges["hub-tron"] = edge([entryX("tron"), hub.y], [cx(tron), tron.y + tron.h + GAP], "y", busFor("tron"));

  return { mode: "column", width, height, boxes, edges };
}

/** Chevron arrowhead ending at `p`, pointing along `dir`. */
export function chevron([x, y]: Point, dir: Dir, size = 4): string {
  switch (dir) {
    case "right":
      return `M${x - size} ${y - size}L${x} ${y}L${x - size} ${y + size}`;
    case "left":
      return `M${x + size} ${y - size}L${x} ${y}L${x + size} ${y + size}`;
    case "down":
      return `M${x - size} ${y - size}L${x} ${y}L${x + size} ${y - size}`;
    case "up":
      return `M${x - size} ${y + size}L${x} ${y}L${x + size} ${y + size}`;
  }
}
