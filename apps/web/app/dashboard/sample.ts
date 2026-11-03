// Sample orders, links and payouts so the dashboard can be seen before checkout ships.
// Everything here is an example: it is always labelled "Sample" on screen and never
// presented as a real payment or a real customer.

export type OrderStatus =
  | "awaiting_payment"
  | "confirming"
  | "held"
  | "captured"
  | "settled"
  | "underpaid"
  | "expired"
  | "voided"
  | "refunding"
  | "refunded"
  | "partially_refunded"
  | "failed";

export type PayPath = "deposit" | "wallet" | "intents";

export interface SampleOrder {
  id: string;
  createdAt: Date;
  item: string;
  link: string;
  /** Invoice amount in USDC. Merchants always receive exactly this (EXACT_OUTPUT). */
  amount: number;
  paidWith: { symbol: string; chain: string; amount: string } | null;
  path: PayPath;
  status: OrderStatus;
  refunded: number;
  refundTo: string;
  confidential: boolean;
  timeline: { at: Date; label: string }[];
}

export interface SampleLink {
  id: string;
  title: string;
  price: number | null;
  createdAt: Date;
  paid: number;
  total: number;
  active: boolean;
}

export interface SamplePayout {
  id: string;
  at: Date;
  amount: number;
  chain: string;
  address: string;
  kind: "withdrawal" | "auto";
  status: "sent" | "pending" | "failed";
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting payment",
  confirming: "Confirming",
  held: "Held",
  captured: "Captured",
  settled: "Settled",
  underpaid: "Underpaid",
  expired: "Expired",
  voided: "Voided",
  refunding: "Refunding",
  refunded: "Refunded",
  partially_refunded: "Part refunded",
  failed: "Failed",
};

/** Tone per status: which pastel the badge wears. */
export const STATUS_TONE: Record<OrderStatus, "mint" | "butter" | "peach" | "lilac" | "plain"> = {
  awaiting_payment: "plain",
  confirming: "lilac",
  held: "butter",
  captured: "mint",
  settled: "mint",
  underpaid: "peach",
  expired: "plain",
  voided: "plain",
  refunding: "lilac",
  refunded: "plain",
  partially_refunded: "plain",
  failed: "peach",
};

export const PATH_LABEL: Record<PayPath, string> = {
  deposit: "Deposit address",
  wallet: "Wallet",
  intents: "NEAR Intents balance",
};

const DAY = 86_400_000;

// [days ago, hour, item, link, amount, paid symbol, chain, paid amount, path, status, refunded, confidential]
type Row = [number, number, string, string, number, string, string, string, PayPath, OrderStatus, number, boolean];
const ROWS: Row[] = [
  [0, 1, "General admission", "Summer Session tickets", 25, "USDT", "Tron", "25.04", "deposit", "confirming", 0, false],
  [0, 3, "VIP ticket", "Summer Session tickets", 80, "USDC", "Base", "80.02", "wallet", "held", 0, false],
  [0, 5, "Invoice #1042", "Your link", 140, "ETH", "Ethereum", "0.0412", "wallet", "settled", 0, true],
  [1, 2, "General admission", "Summer Session tickets", 25, "USDC", "Solana", "25.01", "deposit", "held", 0, false],
  [1, 6, "Tote bag", "Merch", 18, "USDC", "Arbitrum", "18.01", "intents", "settled", 0, false],
  [1, 9, "General admission", "Summer Session tickets", 25, "USDT", "Tron", "21.00", "deposit", "underpaid", 0, false],
  [2, 4, "Invoice #1039", "Your link", 320, "USDC", "Base", "320.03", "wallet", "settled", 0, false],
  [2, 8, "VIP ticket", "Summer Session tickets", 80, "BTC", "Bitcoin", "0.00081", "deposit", "captured", 0, false],
  [3, 1, "General admission", "Summer Session tickets", 25, "USDC", "Base", "25.02", "wallet", "refunded", 25, false],
  [3, 7, "Hoodie", "Merch", 45, "USDC", "NEAR", "45.00", "intents", "partially_refunded", 15, false],
  [4, 3, "Workshop seat", "Your link", 60, "SOL", "Solana", "0.39", "wallet", "settled", 0, false],
  [5, 2, "General admission", "Summer Session tickets", 25, "USDT", "Ethereum", "25.03", "deposit", "voided", 0, false],
  [5, 5, "Invoice #1031", "Your link", 210, "USDC", "Polygon", "210.04", "deposit", "settled", 0, false],
  [6, 6, "Tote bag", "Merch", 18, "USDT", "Tron", "18.02", "deposit", "expired", 0, false],
  [7, 2, "VIP ticket", "Summer Session tickets", 80, "USDC", "Base", "80.01", "wallet", "settled", 0, false],
  [8, 4, "General admission", "Summer Session tickets", 25, "USDC", "Arbitrum", "25.01", "wallet", "failed", 0, false],
  [9, 1, "Invoice #1024", "Your link", 95, "ETH", "Base", "0.0279", "wallet", "settled", 0, false],
  [10, 5, "Hoodie", "Merch", 45, "USDC", "Solana", "45.02", "deposit", "settled", 0, false],
  [11, 3, "General admission", "Summer Session tickets", 25, "USDT", "Tron", "25.03", "deposit", "settled", 0, false],
  [12, 7, "Workshop seat", "Your link", 60, "USDC", "Base", "60.01", "wallet", "settled", 0, false],
];

const REFUND_TO: Record<string, string> = {
  Tron: "TQ4u…8fKd",
  Base: "0x3f1c…a92e",
  Ethereum: "0x8b2d…41c7",
  Solana: "7xKp…Qm2v",
  Bitcoin: "bc1q…7w9h",
  Arbitrum: "0x51e0…c3b8",
  NEAR: "shop-buyer.near",
  Polygon: "0x9a7f…06d1",
};

function timeline(at: Date, status: OrderStatus, path: PayPath, amount: number, refunded: number): { at: Date; label: string }[] {
  const step = (min: number, label: string) => ({ at: new Date(at.getTime() + min * 60_000), label });
  const t = [step(0, "Order created")];
  if (status === "expired") return [...t, step(30, "Payment window closed. Nothing was paid.")];
  t.push(step(2, path === "deposit" ? "Payment sent to deposit address" : path === "wallet" ? "Buyer signed in their wallet" : "Paid from buyer’s NEAR Intents balance"));
  if (status === "awaiting_payment") return t.slice(0, 1);
  if (status === "underpaid") return [...t, step(4, "Received less than the invoice"), step(5, "Refund to buyer’s address started")];
  if (status === "failed") return [...t, step(6, "Swap didn’t complete. 1Click returned the funds to the buyer.")];
  t.push(step(4, "Payment confirmed"));
  if (status === "confirming") return t.slice(0, 2);
  if (["held", "captured", "voided"].includes(status)) t.push(step(5, `${amount.toFixed(2)} USDC held in escrow`));
  if (status === "captured") t.push(step(180, "Captured. Released to your balance."));
  if (status === "voided") t.push(step(240, "Voided. Refunded to the buyer’s original chain."));
  if (["settled", "refunded", "partially_refunded"].includes(status)) t.push(step(5, `${amount.toFixed(2)} USDC in your balance`));
  if (refunded > 0) t.push(step(600, `Refunded ${refunded.toFixed(2)} USDC to the buyer’s original token and chain`));
  return t;
}

/** Built relative to now so the sample always looks recent. */
export function sampleOrders(now = Date.now()): SampleOrder[] {
  return ROWS.map(([daysAgo, hoursAgo, item, link, amount, symbol, chain, paid, path, status, refunded, confidential], i) => {
    const createdAt = new Date(now - daysAgo * DAY - hoursAgo * 3_600_000);
    return {
      id: `ord_${(4821 - i).toString(36)}${(i * 7919).toString(36).padStart(3, "0")}`,
      createdAt,
      item,
      link,
      amount,
      paidWith: status === "expired" || status === "awaiting_payment" ? null : { symbol, chain, amount: paid },
      path,
      status,
      refunded,
      refundTo: REFUND_TO[chain] ?? "—",
      confidential,
      timeline: timeline(createdAt, status, path, amount, refunded),
    };
  });
}

export function sampleLinks(now = Date.now()): SampleLink[] {
  return [
    { id: "lnk_tix", title: "Summer Session tickets", price: null, createdAt: new Date(now - 14 * DAY), paid: 11, total: 435, active: true },
    { id: "lnk_merch", title: "Merch", price: null, createdAt: new Date(now - 12 * DAY), paid: 4, total: 126, active: true },
    { id: "lnk_ws", title: "Workshop seat", price: 60, createdAt: new Date(now - 20 * DAY), paid: 2, total: 120, active: false },
  ];
}

export function samplePayouts(now = Date.now()): SamplePayout[] {
  return [
    { id: "po_7", at: new Date(now - 1 * DAY), amount: 300, chain: "Base", address: "0x5aed…67de", kind: "withdrawal", status: "sent" },
    { id: "po_6", at: new Date(now - 4 * DAY), amount: 150, chain: "Solana", address: "9fQe…kP3a", kind: "withdrawal", status: "sent" },
    { id: "po_5", at: new Date(now - 6 * DAY), amount: 80, chain: "Base", address: "0x5aed…67de", kind: "withdrawal", status: "failed" },
    { id: "po_4", at: new Date(now - 9 * DAY), amount: 420, chain: "Base", address: "0x5aed…67de", kind: "withdrawal", status: "sent" },
  ];
}

/** Money that reached the balance: settled and captured orders, less refunds. */
export const received = (o: SampleOrder) => (["settled", "captured", "partially_refunded"].includes(o.status) ? o.amount - o.refunded : 0);

/** Received USDC per day for the last `days` days, oldest first. */
export function dailyReceived(orders: SampleOrder[], days = 14, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(start.getTime() - (days - 1 - i) * DAY);
    const next = day.getTime() + DAY;
    const total = orders.filter(o => o.createdAt.getTime() >= day.getTime() && o.createdAt.getTime() < next).reduce((s, o) => s + received(o), 0);
    return { day, total };
  });
}

/** The ledger as CSV: one row per order, refund and payout. */
export function ledgerCsv(orders: SampleOrder[], payouts: SamplePayout[]): string {
  const rows: (string | number)[][] = [["date", "type", "reference", "description", "amount_usdc", "paid_with", "chain", "status", "sample"]];
  for (const o of orders) {
    rows.push([o.createdAt.toISOString(), "order", o.id, o.item, o.amount.toFixed(2), o.paidWith ? `${o.paidWith.amount} ${o.paidWith.symbol}` : "", o.paidWith?.chain ?? "", o.status, "yes"]);
    if (o.refunded > 0) rows.push([o.timeline.at(-1)!.at.toISOString(), "refund", o.id, `Refund: ${o.item}`, (-o.refunded).toFixed(2), "", o.paidWith?.chain ?? "", "sent", "yes"]);
  }
  for (const p of payouts) rows.push([p.at.toISOString(), "payout", p.id, `Withdrawal to ${p.address}`, (-p.amount).toFixed(2), "USDC", p.chain, p.status, "yes"]);
  rows.sort((a, b) => (a[0] === "date" ? -1 : b[0] === "date" ? 1 : String(b[0]).localeCompare(String(a[0]))));
  return rows.map(r => r.map(v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n");
}
