import type { Metadata } from "next";
import { Onboarding } from "./Onboarding";

export const metadata: Metadata = {
  title: "Set up Morva",
  robots: { index: false, follow: false },
};

export default function StartPage() {
  return <Onboarding />;
}
