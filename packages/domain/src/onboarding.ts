// The merchant onboarding steps after sign-up (email code, Google or passkey). The server stores
// the furthest step reached; the client resumes from it.
//
// "secure" creates the passkey that controls the merchant's balance. Email and Google sign-in
// reach the dashboard only; money always needs a passkey, so going live needs one.

export const ONBOARDING_STEPS = ["business", "email", "payout", "channels", "defaults", "secure", "backup", "terms", "test_payment", "live"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Steps a merchant may skip. Everything else needs an answer. */
export const SKIPPABLE: ReadonlySet<OnboardingStep> = new Set(["backup", "test_payment"]);

/** Steps passed over automatically once done: an email from sign-up, or a passkey from sign-up. */
const AUTO_PASS: ReadonlySet<OnboardingStep> = new Set(["email", "secure"]);

/** What the step machine needs to know about a merchant. */
export interface OnboardingState {
  handle: string | null;
  business_name: string | null;
  country: string | null;
  contact_email_verified: boolean;
  terms_accepted: boolean;
  has_passkey: boolean;
  onboarding_step: string;
  live: boolean;
}

export function isOnboardingStep(s: string): s is OnboardingStep {
  return (ONBOARDING_STEPS as readonly string[]).includes(s);
}

const index = (s: OnboardingStep) => ONBOARDING_STEPS.indexOf(s);

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[index(step) + 1] ?? null;
}

/** The step before, or null at the first one: the passkey screens can't be revisited. */
export function previousStep(step: OnboardingStep): OnboardingStep | null {
  return index(step) > 0 ? ONBOARDING_STEPS[index(step) - 1]! : null;
}

/** Whether a step's required answers are in, with a plain reason if not. */
export function stepComplete(step: OnboardingStep, m: OnboardingState): { ok: true } | { ok: false; message: string } {
  switch (step) {
    case "business":
      if (!m.business_name?.trim()) return { ok: false, message: "Add your business name." };
      if (!m.handle) return { ok: false, message: "Choose your link name." };
      if (!m.country) return { ok: false, message: "Choose your country." };
      return { ok: true };
    case "email":
      return m.contact_email_verified ? { ok: true } : { ok: false, message: "Confirm your email with the code we sent." };
    case "terms":
      return m.terms_accepted ? { ok: true } : { ok: false, message: "Accept the terms to continue." };
    case "secure":
      return m.has_passkey ? { ok: true } : { ok: false, message: "Create your passkey to protect your balance." };
    default:
      // Payout, channels and defaults always have a valid saved value (their defaults);
      // backup and test payment are skippable.
      return { ok: true };
  }
}

/**
 * Where a returning merchant picks up: the furthest step they reached, unless an earlier
 * required step is somehow incomplete, in which case that one.
 */
export function resumeStep(m: OnboardingState): OnboardingStep {
  if (m.live) return "live";
  const reached: OnboardingStep = isOnboardingStep(m.onboarding_step) ? m.onboarding_step : "business";
  for (const step of ONBOARDING_STEPS.slice(0, index(reached))) {
    if (!stepComplete(step, m).ok) return step;
  }
  return passCompleted(reached, m);
}

/** Moves past steps that are already done and need no answer (see AUTO_PASS). */
export function passCompleted(step: OnboardingStep, m: OnboardingState): OnboardingStep {
  let s = step;
  while (AUTO_PASS.has(s) && stepComplete(s, m).ok) s = nextStep(s) ?? s;
  return s;
}

/**
 * Moving to `to` from the furthest step reached. Going back is always allowed; going forward
 * only one step at a time, and only when the current step is complete or skippable.
 */
export function canAdvance(m: OnboardingState, from: OnboardingStep, opts: { skip?: boolean } = {}): { ok: true; to: OnboardingStep } | { ok: false; message: string } {
  const to = nextStep(from);
  if (!to) return { ok: false, message: "You're already live." };
  if (opts.skip) {
    return SKIPPABLE.has(from) ? { ok: true, to } : { ok: false, message: "This step can't be skipped." };
  }
  const done = stepComplete(from, m);
  return done.ok ? { ok: true, to: passCompleted(to, m) } : done;
}

/** Live needs a business, a confirmed email, a passkey and accepted terms; the rest has defaults. */
export function canGoLive(m: OnboardingState): { ok: true } | { ok: false; message: string } {
  for (const step of ["business", "email", "secure", "terms"] as const) {
    const r = stepComplete(step, m);
    if (!r.ok) return r;
  }
  return { ok: true };
}
