// Merchant handles: the name in a payment link, pay.morva.xyz/<handle>.

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;

/** Words a merchant can't take: Morva's own routes and names that invite impersonation. */
const RESERVED = new Set([
  "about",
  "account",
  "admin",
  "api",
  "app",
  "billing",
  "blog",
  "checkout",
  "dashboard",
  "docs",
  "help",
  "login",
  "logout",
  "morva",
  "near",
  "pay",
  "privacy",
  "security",
  "settings",
  "signup",
  "start",
  "status",
  "support",
  "terms",
  "www",
]);

export type HandleProblem = "too_short" | "too_long" | "characters" | "edges" | "double_hyphen" | "reserved";

export const HANDLE_MESSAGES: Record<HandleProblem, string> = {
  too_short: `Use at least ${HANDLE_MIN} characters.`,
  too_long: `Use at most ${HANDLE_MAX} characters.`,
  characters: "Use letters, numbers and hyphens only.",
  edges: "Start and end with a letter or number.",
  double_hyphen: "Use one hyphen at a time.",
  reserved: "That name is reserved. Try another.",
};

/** Lowercases and trims what the merchant typed; validation runs on the result. */
export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase();
}

export function validateHandle(handle: string): { ok: true } | { ok: false; problem: HandleProblem; message: string } {
  const fail = (problem: HandleProblem) => ({ ok: false as const, problem, message: HANDLE_MESSAGES[problem] });
  if (handle.length < HANDLE_MIN) return fail("too_short");
  if (handle.length > HANDLE_MAX) return fail("too_long");
  if (!/^[a-z0-9-]+$/.test(handle)) return fail("characters");
  if (handle.startsWith("-") || handle.endsWith("-")) return fail("edges");
  if (handle.includes("--")) return fail("double_hyphen");
  if (RESERVED.has(handle)) return fail("reserved");
  return { ok: true };
}
