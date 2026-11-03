import type { Metadata } from "next";
import { DashboardShell } from "./_ui";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s · Morva" },
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <DashboardShell>{children}</DashboardShell>;
}
