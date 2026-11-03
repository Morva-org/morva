"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftRight, Home, Link2, ListOrdered, Settings } from "lucide-react";
import { MorvaMark } from "../MorvaMark";
import { api, type Merchant } from "../start/client";
import { STATUS_LABEL, STATUS_TONE, type OrderStatus } from "./sample";

// --- the signed-in merchant, shared by every dashboard page ------------------------------------

interface Session {
  m: Merchant;
  setM: (m: Merchant) => void;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside the dashboard");
  return s;
}

const NAV = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/dashboard/orders", label: "Orders", icon: ListOrdered },
  { href: "/dashboard/links", label: "Payment links", icon: Link2 },
  { href: "/dashboard/payouts", label: "Payouts", icon: ArrowLeftRight },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [m, setM] = useState<Merchant | null>(null);
  const router = useRouter();
  const path = usePathname();

  const refresh = useCallback(async () => {
    try {
      setM((await api<{ merchant: Merchant }>("GET", "/me")).merchant);
    } catch {
      router.replace("/start");
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const session = useMemo(() => (m ? { m, setM, refresh } : null), [m, refresh]);
  if (!session) return <div className="db" aria-busy="true" />;

  const active = (href: string) => (href === "/dashboard" ? path === href : path.startsWith(href));
  const signOut = async () => {
    await api("POST", "/auth/logout").catch(() => {});
    router.replace("/start");
  };

  return (
    <SessionContext.Provider value={session}>
      <div className="db">
        <aside className="db-side">
          <Link href="/dashboard" className="db-brand">
            <MorvaMark size={22} /> morva
          </Link>
          <nav className="db-nav" aria-label="Dashboard">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="db-nav-item" aria-current={active(href) ? "page" : undefined}>
                <Icon size={18} strokeWidth={1.5} /> {label}
              </Link>
            ))}
          </nav>
          <div className="db-side-foot">
            <span className="db-side-name">{session.m.business_name ?? "Your business"}</span>
            <span className="db-side-email">{session.m.contact_email}</span>
            <button type="button" className="db-quiet" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </aside>

        <header className="db-mobile-top">
          <Link href="/dashboard" className="db-brand">
            <MorvaMark size={22} /> morva
          </Link>
          <nav className="db-tabs" aria-label="Dashboard">
            {NAV.map(({ href, label }) => (
              <Link key={href} href={href} className="db-tab" aria-current={active(href) ? "page" : undefined}>
                {label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="db-main">
          {!session.m.live && (
            <div className="db-notice">
              <span>You’re not live yet. Finish setting up to take payments.</span>
              <Link href="/start" className="btn btn-small">
                Finish setup
              </Link>
            </div>
          )}
          {children}
        </main>
      </div>
    </SessionContext.Provider>
  );
}

// --- small shared pieces -----------------------------------------------------------------------

export function PageHead({ title, lead, actions }: { title: string; lead?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="db-head">
      <div>
        <h1 className="db-title">{title}</h1>
        {lead && <p className="db-lead">{lead}</p>}
      </div>
      {actions && <div className="db-head-actions">{actions}</div>}
    </div>
  );
}

/** Marks a section filled with example data. Always visible next to sample content. */
export function SampleTag() {
  return (
    <span className="db-sample" title="Example data, not real payments">
      Sample
    </span>
  );
}

export function SampleNotice({ children }: { children?: React.ReactNode }) {
  return (
    <p className="db-sample-note">
      <SampleTag /> {children ?? "These are example orders so you can see how Morva works. They aren’t real payments. Your real orders appear here once checkout is live."}
    </p>
  );
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`db-badge tone-${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

const usdFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1,234.50" — amounts are USDC, shown with the unit next to them, never a $ sign. */
export const usdc = (n: number) => usdFmt.format(n);

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

export function when(d: Date, now = Date.now()): string {
  const mins = Math.round((now - d.getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (d.getTime() >= today.getTime()) return `Today, ${timeFmt.format(d)}`;
  if (d.getTime() >= today.getTime() - 86_400_000) return `Yesterday, ${timeFmt.format(d)}`;
  return `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
}

export const shortDate = (d: Date) => dateFmt.format(d);

export function download(text: string, filename: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const PAY_BASE = process.env.NEXT_PUBLIC_PAY_BASE_URL ?? "https://pay.morva.xyz";
