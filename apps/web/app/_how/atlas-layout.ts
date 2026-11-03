// Geometry of the "How it works" atlas: regions, the route and the camera stops, in atlas px.
// Desktop lays the regions out like a map; mobile stacks them so the camera mostly moves down.

export type RegionId = "merchant" | "wallets" | "near" | "escrow";
export type Pt = [number, number];

export type AtlasPanel =
  | "link"
  | "ledger"
  | "webhook"
  | "payout"
  | "walletBase"
  | "walletArb"
  | "walletOp"
  | "walletPoly"
  | "deposit"
  | "sign"
  | "quote"
  | "solvers"
  | "balance"
  | "escrow"
  | "capture"
  | "refundSource";

export interface Region {
  id: RegionId;
  label: string;
  x: number;
  y: number;
  cols: number;
  panels: AtlasPanel[];
}

export interface AtlasLayout {
  w: number;
  h: number;
  regions: Region[];
  /** Orthogonal route through every region and back to the merchant. */
  route: Pt[];
  /** Points on the route where the order card stops: merchant, wallets, NEAR, escrow, merchant. */
  anchors: Pt[];
  /** Dashed refund branch from escrow back to the Optimism wallet. */
  refund: Pt[];
  /** Camera focus for each region, plus the zoomed-out view used on the way back. */
  focus: Record<RegionId | "return", Pt>;
  returnScale: number;
}

export const PANEL_W = 220;
export const PANEL_GAP = 16;
export const regionWidth = (r: Region) => r.cols * PANEL_W + (r.cols - 1) * PANEL_GAP;

const REGIONS = (pos: Record<RegionId, [number, number, number]>): Region[] => [
  { id: "merchant", label: "Merchant", x: pos.merchant[0], y: pos.merchant[1], cols: pos.merchant[2], panels: ["link", "ledger", "webhook", "payout"] },
  {
    id: "wallets",
    label: "Buyer’s wallets",
    x: pos.wallets[0],
    y: pos.wallets[1],
    cols: pos.wallets[2],
    panels: ["walletBase", "walletArb", "walletOp", "walletPoly", "deposit", "sign"],
  },
  { id: "near", label: "NEAR Intents", x: pos.near[0], y: pos.near[1], cols: pos.near[2], panels: ["quote", "solvers", "balance"] },
  { id: "escrow", label: "Escrow", x: pos.escrow[0], y: pos.escrow[1], cols: pos.escrow[2], panels: ["escrow", "capture", "refundSource"] },
];

export const DESKTOP: AtlasLayout = {
  w: 3200,
  h: 2000,
  regions: REGIONS({ merchant: [260, 300, 2], wallets: [1180, 1220, 3], near: [2280, 540, 2], escrow: [2380, 1450, 2] }),
  route: [
    [900, 380],
    [1540, 380],
    [1540, 1110],
    [2200, 1110],
    [2200, 960],
    [3000, 960],
    [3000, 1860],
    [900, 1860],
    [900, 640],
  ],
  anchors: [
    [900, 380],
    [1540, 1110],
    [2560, 960],
    [3000, 1560],
    [900, 640],
  ],
  refund: [
    [3000, 1560],
    [3000, 1720],
    [2040, 1720],
    [2040, 1270],
    [1908, 1270],
  ],
  focus: { merchant: [660, 480], wallets: [1560, 1300], near: [2540, 800], escrow: [2760, 1560], return: [1700, 1200] },
  returnScale: 0.5,
};

export const MOBILE: AtlasLayout = {
  w: 900,
  h: 3500,
  regions: REGIONS({ merchant: [222, 260, 2], wallets: [222, 1160, 2], near: [222, 2240, 2], escrow: [222, 3160, 2] }),
  route: [
    [450, 820],
    [450, 970],
    [80, 970],
    [80, 2050],
    [820, 2050],
    [820, 2990],
    [40, 2990],
    [40, 90],
    [450, 90],
  ],
  anchors: [
    [450, 820],
    [450, 970],
    [450, 2050],
    [450, 2990],
    [450, 90],
  ],
  refund: [
    [450, 2990],
    [450, 3060],
    [140, 3060],
    [140, 1330],
    [218, 1330],
  ],
  focus: { merchant: [450, 660], wallets: [450, 1320], near: [450, 2340], escrow: [450, 3230], return: [450, 1750] },
  returnScale: 0.3,
};

/** An orthogonal path through `pts` with rounded corners. */
export function roundedPath(pts: Pt[], radius = 60): string {
  let d = `M${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]!;
    const [cx, cy] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const ax = cx - ((cx - px) / inLen) * r;
    const ay = cy - ((cy - py) / inLen) * r;
    const bx = cx + ((nx - cx) / outLen) * r;
    const by = cy + ((ny - cy) / outLen) * r;
    d += `L${ax} ${ay}Q${cx} ${cy} ${bx} ${by}`;
  }
  const last = pts[pts.length - 1]!;
  return `${d}L${last[0]} ${last[1]}`;
}
