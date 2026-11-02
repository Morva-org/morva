"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Download, Fingerprint, RotateCcw } from "lucide-react";
import { normalizeHandle, ONBOARDING_STEPS, PAYOUT_CHAINS, previousStep, resumeStep, validateHandle, validatePayoutAddress, type OnboardingStep } from "@morva/domain";
import { MorvaMark } from "../MorvaMark";
import {
  addBackupDevice,
  api,
  ApiError,
  createPasskey,
  download,
  GOOGLE_START,
  googleError,
  logInWithPasskey,
  passkeyMessage,
  qrPng,
  qrSvg,
  sendLoginCode,
  signWithPasskey,
  verifyLoginCode,
  type Merchant,
} from "./client";
import { countries } from "./countries";

// Merchant onboarding: sign up with email, Google or a passkey, then one question per screen,
// saved as you go and resumable from any device.

type Screen = "loading" | "auth" | OnboardingStep;
const PAY_BASE = process.env.NEXT_PUBLIC_PAY_BASE_URL ?? "https://pay.morva.xyz";
const rpId = () => process.env.NEXT_PUBLIC_RP_ID ?? window.location.hostname;

const LABELS: Record<OnboardingStep, string> = {
  business: "Your business",
  email: "Your email",
  payout: "How you get paid",
  channels: "How you sell",
  defaults: "Order defaults",
  secure: "Protect your balance",
  backup: "Backup device",
  terms: "Terms",
  test_payment: "Test payment",
  live: "Go live",
};

const stateOf = (m: Merchant) => ({
  handle: m.handle,
  business_name: m.business_name,
  country: m.country,
  contact_email_verified: m.contact_email_verified,
  terms_accepted: m.terms_accepted,
  has_passkey: m.has_passkey,
  onboarding_step: m.onboarding_step,
  live: m.live,
});

/** The steps shown in the rail: email only for merchants who still need to confirm one. */
const visibleSteps = (m: Merchant, screen: Screen) => ONBOARDING_STEPS.filter(s => s !== "email" || !m.contact_email_verified || screen === "email");

/** Going back skips steps that were done for the merchant (a confirmed email, a passkey). */
function backFrom(screen: OnboardingStep, m: Merchant): OnboardingStep | null {
  if (screen === "live") return null;
  let s = previousStep(screen);
  while (s && ((s === "email" && m.contact_email_verified) || s === "secure")) s = previousStep(s);
  return s;
}

interface StepProps {
  m: Merchant;
  setM: (m: Merchant) => void;
  next: (skip?: boolean) => Promise<void>;
}

export function Onboarding() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [m, setM] = useState<Merchant | null>(null);

  const enter = useCallback((merchant: Merchant) => {
    setM(merchant);
    setScreen(resumeStep(stateOf(merchant)));
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    api<{ merchant: Merchant }>("GET", "/me")
      .then(r => enter(r.merchant))
      .catch(() => setScreen("auth"));
  }, [enter]);

  const next = useCallback(
    async (skip = false) => {
      if (!m || screen === "loading" || screen === "auth") return;
      const r = await api<{ step: OnboardingStep; merchant: Merchant }>("POST", "/onboarding/step", { from: screen, skip });
      setM(r.merchant);
      setScreen(r.step);
      window.scrollTo({ top: 0 });
    },
    [m, screen],
  );

  const signOut = async () => {
    await api("POST", "/auth/logout").catch(() => {});
    setM(null);
    setScreen("auth");
  };

  if (screen === "loading") return <div className="ob" aria-busy="true" />;
  if (screen === "auth" || !m) return <Auth onSignedIn={enter} />;

  const steps = visibleSteps(m, screen);
  const at = steps.indexOf(screen);
  const furthest = Math.max(at, steps.indexOf(resumeStep(stateOf(m))));
  const back = backFrom(screen, m);
  const revisitable = (s: OnboardingStep) => !["secure", "backup", "test_payment", "live"].includes(s);

  return (
    <div className="ob ob-shell">
      <aside className="ob-rail">
        <span className="ob-brand">
          <MorvaMark size={22} /> morva
        </span>
        <ol className="ob-rail-steps">
          {steps.map((s, i) => {
            const state = i === at ? "is-current" : i < furthest ? "is-done" : "";
            const canGo = state === "is-done" && revisitable(s) && !m.live;
            return (
              <li key={s} className={state}>
                <span className="ob-rail-dot" aria-hidden="true">
                  {state === "is-done" && <Check size={12} strokeWidth={2} />}
                </span>
                {canGo ? (
                  <button type="button" onClick={() => setScreen(s)}>
                    {LABELS[s]}
                  </button>
                ) : (
                  <span aria-current={i === at ? "step" : undefined}>{LABELS[s]}</span>
                )}
              </li>
            );
          })}
        </ol>
        <div className="ob-rail-foot">
          {m.contact_email && <span className="ob-rail-email">{m.contact_email}</span>}
          <button type="button" className="ob-link ob-link-quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="ob-pane">
        <header className="ob-top">
          <div className="ob-bar">
            {back ? (
              <button type="button" className="ob-back" onClick={() => setScreen(back)}>
                <ArrowLeft size={18} strokeWidth={1.5} /> Back
              </button>
            ) : (
              <span />
            )}
            <span className="ob-brand ob-brand-top">
              <MorvaMark size={22} /> morva
            </span>
            <span className="ob-count num">
              Step {at + 1} of {steps.length}
            </span>
          </div>
          <div className="ob-segments" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s} className={i <= at ? "is-on" : ""} />
            ))}
          </div>
        </header>

        <main className="ob-main" key={screen}>
          {screen === "business" && <Business m={m} setM={setM} next={next} />}
          {screen === "email" && <Email m={m} setM={setM} next={next} />}
          {screen === "payout" && <Payout m={m} setM={setM} next={next} />}
          {screen === "channels" && <Channels m={m} setM={setM} next={next} />}
          {screen === "defaults" && <Defaults m={m} setM={setM} next={next} />}
          {screen === "secure" && <Secure m={m} setM={setM} next={next} />}
          {screen === "backup" && <Backup m={m} setM={setM} next={next} />}
          {screen === "terms" && <Terms m={m} setM={setM} next={next} />}
          {screen === "test_payment" && <TestPayment m={m} setM={setM} next={next} />}
          {screen === "live" && <Live m={m} setM={setM} next={next} />}
        </main>
      </div>
    </div>
  );
}

// --- shared bits ------------------------------------------------------------------------------

function Title({ children, lead }: { children: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <div className="ob-head">
      <h1 className="ob-title">{children}</h1>
      {lead && <p className="ob-lead">{lead}</p>}
    </div>
  );
}

function Continue({ onClick, disabled, children = "Continue" }: { onClick: () => Promise<void> | void; disabled?: boolean; children?: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="ob-actions">
      {error && <p className="ob-error">{error}</p>}
      <button
        type="button"
        className="btn btn-accent btn-block"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onClick();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : passkeyMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "One moment…" : children}
      </button>
    </div>
  );
}

/** Saves a patch after the merchant pauses typing. */
function useAutosave(path: string, setM: (m: Merchant) => void, delay = 500) {
  const timer = useRef<number | null>(null);
  const [state, setState] = useState<{ saving: boolean; error: string | null; field?: string }>({ saving: false, error: null });
  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      setState({ saving: true, error: null });
      try {
        const r = await api<{ merchant: Merchant }>("PATCH", path, patch);
        setM(r.merchant);
        setState({ saving: false, error: null });
        return true;
      } catch (e) {
        setState({ saving: false, error: e instanceof ApiError ? e.message : "Couldn't save. Check your connection.", field: e instanceof ApiError ? e.field : undefined });
        return false;
      }
    },
    [path, setM],
  );
  const later = useCallback(
    (patch: Record<string, unknown>) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(patch), delay);
    },
    [save, delay],
  );
  return { save, later, ...state };
}

/** Six boxes over one real input, so paste, autofill and one-time-code suggestions all work. */
function CodeInput({ value, onChange, disabled, invalid }: { value: string; onChange: (v: string) => void; disabled?: boolean; invalid?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <div className={`ob-otp${invalid ? " is-invalid" : ""}`}>
      <input
        aria-label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={value}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={`ob-otp-box num${focused && i === Math.min(value.length, 5) ? " is-active" : ""}`} aria-hidden="true">
          {value[i] ?? ""}
        </span>
      ))}
    </div>
  );
}

// --- sign up or log in --------------------------------------------------------------------------

function GoogleG() {
  // Google's sign-in guidelines require the full-colour G on this button.
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const RESEND_AFTER_S = 30;

// Footage: "Person Using Her Smartphone For Electronic Payment" by Marcus Aurelius, Pexels
// (free to use, pexels.com/video/4109600). Only seconds 2–14 show the payment, so we loop those.
const CLIP = { from: 2, to: 14 };

/** The sign-in panel's background: the poster on its own, the clip on wide screens with motion allowed. */
function PanelMedia() {
  const ref = useRef<HTMLVideoElement>(null);
  const [play, setPlay] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 960px)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPlay(wide.matches && !calm.matches);
    update();
    wide.addEventListener("change", update);
    calm.addEventListener("change", update);
    return () => {
      wide.removeEventListener("change", update);
      calm.removeEventListener("change", update);
    };
  }, []);

  return (
    <div className="ob-auth-media" aria-hidden="true">
      <img src="/start/paying.jpg" alt="" />
      {play && (
        <video
          ref={ref}
          src={`/start/paying.mp4#t=${CLIP.from}`}
          muted
          autoPlay
          playsInline
          preload="auto"
          onCanPlay={e => e.currentTarget.classList.add("is-ready")}
          onTimeUpdate={e => {
            if (e.currentTarget.currentTime >= CLIP.to) e.currentTarget.currentTime = CLIP.from;
          }}
        />
      )}
    </div>
  );
}

function Auth({ onSignedIn }: { onSignedIn: (m: Merchant) => void }) {
  const [google, setGoogle] = useState(false);
  const [stage, setStage] = useState<"start" | "code">("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"email" | "code" | "passkey" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    void api<{ google: boolean }>("GET", "/auth/methods")
      .then(r => setGoogle(r.google))
      .catch(() => {});
    const params = new URLSearchParams(window.location.search);
    const fromGoogle = googleError(params.get("error"));
    if (fromGoogle) {
      setError(fromGoogle);
      window.history.replaceState(null, "", "/start");
    }
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait(w => w - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  const send = async () => {
    setBusy("email");
    setError(null);
    try {
      await sendLoginCode(email.trim());
      setStage("code");
      setCode("");
      setWait(RESEND_AFTER_S);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t send the code. Check your connection.");
    } finally {
      setBusy(null);
    }
  };

  const verify = async (value: string) => {
    setBusy("code");
    setError(null);
    try {
      onSignedIn(await verifyLoginCode(email.trim(), value));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t check the code.");
      setCode("");
      setBusy(null);
    }
  };

  return (
    <div className="ob ob-auth">
      <aside className="ob-auth-panel">
        <PanelMedia />
        <span className="ob-brand">
          <MorvaMark size={24} ink="#FFFFFF" /> morva
        </span>
        <div className="ob-auth-pitch">
          <h2>Take crypto payments from any chain. Keep USDC.</h2>
          <ul>
            <li>
              <Check size={16} strokeWidth={1.5} /> Customers pay with what they hold, on the chain they use.
            </li>
            <li>
              <Check size={16} strokeWidth={1.5} /> You receive the exact amount you asked for.
            </li>
            <li>
              <Check size={16} strokeWidth={1.5} /> Only your passkey can move your balance. Not Morva.
            </li>
          </ul>
        </div>
        <p className="ob-auth-small">Set-up takes about three minutes. No card, no bank account, no seed phrase.</p>
      </aside>

      <main className="ob-auth-main">
        <a href="/" className="ob-brand ob-auth-logo">
          <MorvaMark size={22} /> morva
        </a>
        {stage === "start" ? (
          <div className="ob-auth-card">
            <Title lead="Create an account or log in. We’ll find your account by email.">Get started</Title>
            <div className="ob-auth-methods">
              {google && (
                <>
                  <a className="btn btn-outline btn-block ob-google" href={GOOGLE_START}>
                    <GoogleG /> Continue with Google
                  </a>
                  <div className="ob-divider">or</div>
                </>
              )}
              <form
                className="ob-fields"
                onSubmit={e => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label className="field">
                  Work email
                  <input type="email" required autoComplete="email" placeholder="you@business.com" value={email} onChange={e => setEmail(e.target.value)} />
                </label>
                <button type="submit" className="btn btn-accent btn-block ob-tall" disabled={!email.trim() || busy !== null}>
                  {busy === "email" ? "Sending code…" : "Continue with email"}
                </button>
              </form>
            </div>
            {error && <p className="ob-error">{error}</p>}
            <div className="ob-auth-alt">
              <button
                type="button"
                className="ob-link"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy("passkey");
                  setError(null);
                  try {
                    onSignedIn(await logInWithPasskey());
                  } catch (e) {
                    setError(passkeyMessage(e));
                    setBusy(null);
                  }
                }}
              >
                <Fingerprint size={16} strokeWidth={1.5} /> Log in with a passkey
              </button>
            </div>
            <p className="ob-auth-terms">
              By continuing you agree to the{" "}
              <a href="/terms" target="_blank" rel="noreferrer">
                terms of service
              </a>
              .
            </p>
          </div>
        ) : (
          <div className="ob-auth-card">
            <Title
              lead={
                <>
                  We sent a 6-digit code to <strong className="ob-ink">{email.trim()}</strong>. It expires in 10 minutes.
                </>
              }
            >
              Check your email
            </Title>
            <CodeInput
              value={code}
              disabled={busy === "code"}
              invalid={Boolean(error)}
              onChange={v => {
                setCode(v);
                if (error) setError(null);
                if (v.length === 6) void verify(v);
              }}
            />
            <p className={error ? "ob-error" : "ob-muted"} aria-live="polite">
              {error ?? (busy === "code" ? "Checking…" : "\u00a0")}
            </p>
            <div className="ob-auth-alt ob-auth-row">
              <button
                type="button"
                className="ob-link"
                onClick={() => {
                  setStage("start");
                  setError(null);
                }}
              >
                Use a different email
              </button>
              <button type="button" className="ob-link" disabled={wait > 0 || busy !== null} onClick={() => void send()}>
                {wait > 0 ? `Resend in ${wait}s` : "Send a new code"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// --- protect your balance: the passkey that holds it -------------------------------------------

function Secure({ m, setM, next }: StepProps) {
  const [phase, setPhase] = useState<"idle" | "prompt" | "done">(m.has_passkey ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [explain, setExplain] = useState(false);

  const run = async () => {
    setPhase("prompt");
    setError(null);
    try {
      setM(await createPasskey());
      setPhase("done");
    } catch (e) {
      setError(passkeyMessage(e));
      setPhase("idle");
    }
  };

  return (
    <>
      <Title lead="Your balance is opened by a passkey on this device. Only your passkeys can move money: not your email, not Google, not Morva.">Protect your balance</Title>
      <div className={`ob-key${phase === "done" ? " is-done" : ""}`}>
        <span className="ob-key-icon" aria-hidden="true">
          {phase === "done" ? <Check size={22} strokeWidth={1.5} /> : <Fingerprint size={22} strokeWidth={1.5} />}
        </span>
        <span className="ob-key-text">
          <span className="ob-option-title">{phase === "done" ? "Your balance is ready" : "Passkey on this device"}</span>
          <span className="ob-option-body" aria-live="polite">
            {phase === "done" && m.intents_account_id ? (
              <span className="ob-mono">
                {m.intents_account_id.slice(0, 8)}…{m.intents_account_id.slice(-6)}
              </span>
            ) : phase === "prompt" ? (
              "Follow the prompt on your device…"
            ) : (
              "Face ID, your fingerprint or your device PIN."
            )}
          </span>
        </span>
      </div>
      {phase !== "done" && (
        <div className="ob-explain">
          <button type="button" className="ob-link ob-link-quiet" aria-expanded={explain} onClick={() => setExplain(v => !v)}>
            What’s a passkey?
          </button>
          {explain && (
            <p className="ob-popover" role="note">
              A passkey replaces passwords. You confirm with Face ID, your fingerprint or your device PIN, and the key never leaves your device, so nobody else can
              sign for you.
            </p>
          )}
        </div>
      )}
      {error && <p className="ob-error">{error}</p>}
      {phase === "done" ? (
        <Continue onClick={() => next()} />
      ) : (
        <div className="ob-actions">
          <button type="button" className="btn btn-accent btn-block" disabled={phase === "prompt"} onClick={() => void run()}>
            {phase === "prompt" ? "Waiting for your device…" : "Create passkey"}
          </button>
        </div>
      )}
    </>
  );
}

// --- business --------------------------------------------------------------------------

function Business({ m, setM, next }: StepProps) {
  const [name, setName] = useState(m.business_name ?? "");
  const [handle, setHandle] = useState(m.handle ?? "");
  const [country, setCountry] = useState(m.country ?? "");
  const [handleState, setHandleState] = useState<{ ok: boolean; message: string } | null>(m.handle ? { ok: true, message: "Yours" } : null);
  const saver = useAutosave("/onboarding/business", setM);
  const list = useMemo(() => countries(), []);
  const handleTimer = useRef<number | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  const checkHandle = (raw: string) => {
    const h = normalizeHandle(raw);
    setHandle(h);
    if (handleTimer.current) window.clearTimeout(handleTimer.current);
    const local = validateHandle(h);
    if (!local.ok) {
      setHandleState(h ? { ok: false, message: local.message } : null);
      return;
    }
    setHandleState({ ok: false, message: "Checking…" });
    handleTimer.current = window.setTimeout(async () => {
      const r = await api<{ available: boolean; message?: string }>("GET", `/handles/${encodeURIComponent(h)}`).catch(() => null);
      if (!r) return setHandleState({ ok: false, message: "Couldn't check. Try again." });
      setHandleState(r.available ? { ok: true, message: "Available" } : { ok: false, message: r.message ?? "Not available." });
      if (r.available) void saver.save({ handle: h });
    }, 350);
  };

  const ready = name.trim() && handleState?.ok && country;
  return (
    <>
      <Title lead="This is what customers see when they pay you.">Your business</Title>
      <div className="ob-fields">
        <label className="field">
          Business name
          <input
            value={name}
            autoComplete="organization"
            onChange={e => {
              setName(e.target.value);
              saver.later({ business_name: e.target.value });
            }}
          />
        </label>
        <label className="field">
          Your link
          <span className="ob-prefix">
            <span className="ob-prefix-text">{PAY_BASE.replace(/^https?:\/\//, "")}/</span>
            <input value={handle} autoCapitalize="none" spellCheck={false} onChange={e => checkHandle(e.target.value)} aria-describedby="handle-note" />
          </span>
          <span id="handle-note" className={handleState?.ok ? "ob-ok" : "ob-note"}>
            {handleState?.message ?? "Letters, numbers and hyphens."}
          </span>
        </label>
        <label className="field">
          Country
          <select
            value={country}
            onChange={e => {
              setCountry(e.target.value);
              void saver.save({ country: e.target.value });
            }}
          >
            <option value="">Choose…</option>
            {list.map(c => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>
            Logo <span className="ob-muted">(optional)</span>
          </span>
          <div className="ob-logo">
            {m.logo_url ? <img src={m.logo_url} alt="" width={48} height={48} /> : <span className="ob-logo-empty" />}
            <label className="btn btn-outline btn-small">
              {m.logo_url ? "Replace" : "Upload"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setLogoError(null);
                  try {
                    setM((await api<{ merchant: Merchant }>("POST", "/onboarding/logo", file)).merchant);
                  } catch (err) {
                    setLogoError(err instanceof ApiError ? err.message : "Couldn't upload. Try again.");
                  }
                }}
              />
            </label>
          </div>
          {logoError && <span className="ob-error">{logoError}</span>}
        </div>
      </div>
      {saver.error && <p className="ob-error">{saver.error}</p>}
      <Continue
        disabled={!ready}
        onClick={async () => {
          if (await saver.save({ business_name: name, handle, country })) await next();
        }}
      />
    </>
  );
}

// --- email (only when sign-up didn’t confirm one) ---------------------------------------------------------------------------------

function Email({ m, setM, next }: StepProps) {
  const [email, setEmail] = useState(m.contact_email ?? "");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const verify = async (value: string) => {
    setError(null);
    try {
      await api("POST", "/me/email/verify", { code: value });
      setM((await api<{ merchant: Merchant }>("GET", "/me")).merchant);
    } catch (e) {
      setError(e instanceof ApiError ? (e.code === "code_wrong" ? "That code isn't right. Check the email and try again." : e.message) : "Couldn't check the code.");
    }
  };

  return (
    <>
      <Title lead="For receipts, payout notices and account recovery. It can never be used to move your money.">Your email</Title>
      {m.contact_email_verified ? (
        <p className="ob-ok ob-confirmed">
          <Check size={16} strokeWidth={1.5} /> {m.contact_email} is confirmed.
        </p>
      ) : (
        <div className="ob-fields">
          <label className="field">
            Email
            <input type="email" value={email} autoComplete="email" onChange={e => setEmail(e.target.value)} />
          </label>
          {sent && (
            <label className="field">
              6-digit code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, "");
                  setCode(v);
                  if (v.length === 6) void verify(v);
                }}
              />
              <span className="ob-note">We sent it to {email}. It expires in 10 minutes.</span>
            </label>
          )}
          {error && <p className="ob-error">{error}</p>}
          <button
            type="button"
            className={sent ? "ob-link" : "btn btn-outline"}
            onClick={async () => {
              setError(null);
              try {
                await api("POST", "/me/email", { email });
                setSent(true);
                setCode("");
              } catch (e) {
                setError(e instanceof ApiError ? (e.code === "invalid_email" ? "Check the email address." : e.message) : "Couldn't send the code.");
              }
            }}
          >
            {sent ? "Send a new code" : "Send code"}
          </button>
        </div>
      )}
      <Continue disabled={!m.contact_email_verified} onClick={() => next()} />
    </>
  );
}

// --- payout --------------------------------------------------------------------------------

function Payout({ m, setM, next }: StepProps) {
  const [mode, setMode] = useState(m.payout_mode);
  const [chain, setChain] = useState(m.payout_chain ?? "base");
  const [address, setAddress] = useState(m.payout_address ?? "");
  const saver = useAutosave("/onboarding/payout", setM);
  const check = address ? validatePayoutAddress(chain, address) : null;
  const ready = mode === "keep_in_balance" || check?.ok;

  return (
    <>
      <Title lead="You can change this anytime.">How you get paid</Title>
      <div className="ob-options" role="radiogroup" aria-label="How you get paid">
        <button
          type="button"
          role="radio"
          aria-checked={mode === "keep_in_balance"}
          className="ob-option"
          onClick={() => {
            setMode("keep_in_balance");
            void saver.save({ mode: "keep_in_balance" });
          }}
        >
          <span className="ob-option-title">Keep in my Morva balance (USDC)</span>
          <span className="ob-option-body">Payments collect in your balance. Withdraw to any chain whenever you like.</span>
        </button>
        <button type="button" role="radio" aria-checked={mode === "auto_payout"} className="ob-option" onClick={() => setMode("auto_payout")}>
          <span className="ob-option-title">Send automatically to my wallet</span>
          <span className="ob-option-body">Each payment goes straight to your wallet as USDC.</span>
        </button>
      </div>
      {mode === "auto_payout" && (
        <div className="ob-fields">
          <label className="field">
            Network
            <select
              value={chain}
              onChange={e => {
                setChain(e.target.value);
                const c = validatePayoutAddress(e.target.value, address);
                if (c.ok) void saver.save({ mode: "auto_payout", chain: e.target.value, address: c.address });
              }}
            >
              {PAYOUT_CHAINS.map(c => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Your wallet address on {PAYOUT_CHAINS.find(c => c.id === chain)?.label}
            <input
              value={address}
              spellCheck={false}
              autoCapitalize="none"
              onChange={e => {
                setAddress(e.target.value);
                const c = validatePayoutAddress(chain, e.target.value);
                if (c.ok) saver.later({ mode: "auto_payout", chain, address: c.address });
              }}
            />
            {check && !check.ok && <span className="ob-error">{check.message}</span>}
          </label>
          <p className="ob-warning">Refunds after payment won’t be possible from Morva. Use holds if you may need to refund.</p>
        </div>
      )}
      {saver.error && <p className="ob-error">{saver.error}</p>}
      <Continue
        disabled={!ready}
        onClick={async () => {
          const ok = mode === "keep_in_balance" ? await saver.save({ mode }) : await saver.save({ mode, chain, address: (check as { address: string }).address });
          if (ok) await next();
        }}
      />
    </>
  );
}

// --- how you sell -------------------------------------------------------------------------

const CHANNELS: { id: string; label: string; body: string; soon?: boolean }[] = [
  { id: "payment_links", label: "Payment links and QR", body: "Share a link or show a QR code. Works for everyone." },
  { id: "events", label: "Events and tickets", body: "Sell tickets through PartyStack.", soon: true },
  { id: "shopify", label: "Shopify", body: "Add Morva to your Shopify checkout.", soon: true },
  { id: "woocommerce", label: "WooCommerce", body: "Add Morva to your WordPress store.", soon: true },
];

function Channels({ m, setM, next }: StepProps) {
  const [picked, setPicked] = useState<string[]>(m.sales_channels.length ? m.sales_channels : ["payment_links"]);
  const [advanced, setAdvanced] = useState(m.sales_channels.includes("own_site"));
  const saver = useAutosave("/onboarding/channels", setM);
  const toggle = (id: string) => {
    const nextPicked = picked.includes(id) ? picked.filter(p => p !== id) : [...picked, id];
    setPicked(nextPicked);
    if (nextPicked.length) void saver.save({ channels: nextPicked });
  };
  const option = (c: { id: string; label: string; body: string; soon?: boolean }) => (
    <button key={c.id} type="button" role="checkbox" aria-checked={picked.includes(c.id)} className="ob-option" onClick={() => toggle(c.id)}>
      <span className="ob-option-title">
        {c.label}
        {c.soon && <span className="ob-soon">Coming soon</span>}
      </span>
      <span className="ob-option-body">{c.body}</span>
    </button>
  );
  return (
    <>
      <Title lead="Pick any that apply. We’ll set up what you need next.">How you sell</Title>
      <div className="ob-options">{CHANNELS.map(option)}</div>
      <button type="button" className="ob-link" aria-expanded={advanced} onClick={() => setAdvanced(v => !v)}>
        {advanced ? "Hide advanced" : "Advanced"}
      </button>
      {advanced && <div className="ob-options">{option({ id: "own_site", label: "My own website", body: "API keys and webhooks for your developers." })}</div>}
      {saver.error && <p className="ob-error">{saver.error}</p>}
      <Continue disabled={!picked.length} onClick={() => next()} />
    </>
  );
}

// --- order defaults -----------------------------------------------------------------------

function Toggle({ on, onChange, title, body }: { on: boolean; onChange: (v: boolean) => void; title: string; body: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="ob-toggle" onClick={() => onChange(!on)}>
      <span className="ob-toggle-text">
        <span className="ob-option-title">{title}</span>
        <span className="ob-option-body">{body}</span>
      </span>
      <span className="ob-switch" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

function Defaults({ m, setM, next }: StepProps) {
  const saver = useAutosave("/onboarding/defaults", setM);
  return (
    <>
      <Title lead="These apply to new orders. You can change them per order.">Defaults for orders</Title>
      <div className="ob-options">
        <Toggle
          on={m.hold_by_default}
          onChange={v => void saver.save({ hold_by_default: v })}
          title="Hold payments until delivery"
          body="Money waits in escrow until you capture it, for example at check-in."
        />
        <div className="ob-option ob-static" role="radiogroup" aria-label="Refunds">
          <span className="ob-option-title">Refunds</span>
          <span className="ob-option-body">When you refund, where does the money go?</span>
          <div className="ob-radios">
            {(
              [
                ["full_to_source", "Full refund to the buyer’s original token and chain"],
                ["none", "No automatic refunds"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="ob-radio">
                <input type="radio" name="refund" checked={m.refund_policy_default === value} onChange={() => void saver.save({ refund_policy_default: value })} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <Toggle
          on={m.confidential_default}
          onChange={v => void saver.save({ confidential_default: v })}
          title="Confidential mode"
          body="Settles through NEAR Intents’ confidential balances, so payment details stay out of public view where supported."
        />
      </div>
      {saver.error && <p className="ob-error">{saver.error}</p>}
      <Continue onClick={() => next()} />
    </>
  );
}

// --- backup device -------------------------------------------------------------------------

function Backup({ next }: StepProps) {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Title lead="A second passkey, on your phone or a security key, so you can still reach your money if this device is lost.">Add a backup device</Title>
      {state === "done" ? (
        <p className="ob-ok ob-confirmed">
          <Check size={16} strokeWidth={1.5} /> Backup device added. Either passkey can now reach your balance.
        </p>
      ) : (
        <>
          <ol className="ob-steps">
            <li>Choose your phone or security key in the prompt.</li>
            <li>Confirm with this device’s passkey to add it to your balance.</li>
          </ol>
          {error && <p className="ob-error">{error}</p>}
          <button
            type="button"
            className="btn btn-outline btn-block"
            disabled={state === "working"}
            onClick={async () => {
              setState("working");
              setError(null);
              try {
                await addBackupDevice(rpId());
                setState("done");
              } catch (e) {
                setError(e instanceof ApiError ? e.message : passkeyMessage(e));
                setState("idle");
              }
            }}
          >
            {state === "working" ? "Adding…" : "Add a backup device"}
          </button>
        </>
      )}
      {state === "done" ? (
        <Continue onClick={() => next()} />
      ) : (
        <div className="ob-skip">
          <p className="ob-warning">
            Without a backup, losing this device means losing access to your balance. Until you add one, withdrawals and payout changes over $100 are blocked.
          </p>
          <button type="button" className="ob-link" onClick={() => void next(true)}>
            Skip for now
          </button>
        </div>
      )}
    </>
  );
}

// --- terms -----------------------------------------------------------------------------------

function Terms({ m, setM, next }: StepProps) {
  const [accepted, setAccepted] = useState(m.terms_accepted);
  return (
    <>
      <Title>What Morva does, and doesn’t</Title>
      <ul className="ob-summary">
        <li>
          <strong>Morva never holds your money.</strong> It sits in your own NEAR Intents balance, controlled only by your passkeys. We can’t move it, freeze it or
          recover it for you.
        </li>
        <li>
          <strong>Payments are routed by NEAR Intents.</strong> Independent solvers fill each payment so you receive the exact amount you asked for.
        </li>
        <li>
          <strong>During a swap, funds pass briefly through 1Click’s swapping agent</strong> on their way to your balance. That step is trusted, not trustless.
        </li>
        <li>
          <strong>Crypto payments are final.</strong> Refunds are something you choose to send; Morva can’t reverse a payment.
        </li>
      </ul>
      <label className="ob-check">
        <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
        <span>
          I accept the{" "}
          <a href="/terms" target="_blank" rel="noreferrer">
            terms of service
          </a>
          .
        </span>
      </label>
      <Continue
        disabled={!accepted}
        onClick={async () => {
          setM((await api<{ merchant: Merchant }>("POST", "/onboarding/terms", { accept: true })).merchant);
          await next();
        }}
      />
    </>
  );
}

// --- test payment ------------------------------------------------------------------------

interface TestPaymentView {
  deposit_address: string;
  amount_in: string;
  refund_address: string;
  status: string;
  received_amount: string | null;
  refund_status: string | null;
  refunded: boolean;
}

const usdc = (units: string | null) => (units ? (Number(units) / 1e6).toFixed(2) : "0.00");

function TestPayment({ next }: StepProps) {
  const [t, setT] = useState<TestPaymentView | null>(null);
  const [refundTo, setRefundTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ test_payment: TestPaymentView | null }>("GET", "/onboarding/test-payment").then(r => setT(r.test_payment)).catch(() => {});
  }, []);

  // Watch the payment, then the refund, until each finishes.
  useEffect(() => {
    const waiting = t && (!["SUCCESS", "REFUNDED", "FAILED"].includes(t.status) || (t.refund_status && !["SUCCESS", "REFUNDED", "FAILED"].includes(t.refund_status)));
    if (!waiting) return;
    const id = window.setInterval(async () => {
      const r = await api<{ test_payment: TestPaymentView }>("GET", "/onboarding/test-payment").catch(() => null);
      if (r) setT(r.test_payment);
    }, 5000);
    return () => window.clearInterval(id);
  }, [t]);

  const check = refundTo ? validatePayoutAddress("base", refundTo) : null;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : passkeyMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Title lead="Pay yourself $2 from Base to see what your customers see. You’ll refund it with one tap.">Try a test payment</Title>
      {!t && (
        <div className="ob-fields">
          <label className="field">
            Your Base wallet address
            <input value={refundTo} spellCheck={false} autoCapitalize="none" onChange={e => setRefundTo(e.target.value)} placeholder="0x…" />
            <span className={check && !check.ok ? "ob-error" : "ob-note"}>{check && !check.ok ? check.message : "The $2 comes back here."}</span>
          </label>
          <button
            type="button"
            className="btn btn-outline btn-block"
            disabled={!check?.ok || busy}
            onClick={() =>
              run(async () => {
                setT((await api<{ test_payment: TestPaymentView }>("POST", "/onboarding/test-payment", { refund_address: refundTo })).test_payment);
              })
            }
          >
            Start test payment
          </button>
        </div>
      )}

      {t && t.status !== "SUCCESS" && t.status !== "REFUNDED" && (
        <div className="ob-pay">
          <p className="ob-pay-amount num">
            Send <strong>{usdc(t.amount_in)} USDC</strong> on Base
          </p>
          <div className="ob-qr" dangerouslySetInnerHTML={{ __html: qrSvg(t.deposit_address) }} />
          <p className="ob-address">{t.deposit_address}</p>
          <button type="button" className="ob-link" onClick={() => void navigator.clipboard.writeText(t.deposit_address)}>
            Copy address
          </button>
          <p className="ob-muted" aria-live="polite">
            {t.status === "PENDING_DEPOSIT" ? "Waiting for your payment…" : t.status === "FAILED" ? "The payment didn't go through. Your USDC is sent back to you." : "Payment seen. Confirming…"}
          </p>
        </div>
      )}

      {t?.status === "SUCCESS" && !t.refund_status && (
        <div className="ob-pay">
          <p className="ob-ok ob-confirmed">
            <Check size={16} strokeWidth={1.5} /> {usdc(t.received_amount)} USDC arrived in your balance.
          </p>
          <p className="ob-muted">That’s what customers see. Now send it back to {t.refund_address.slice(0, 6)}…{t.refund_address.slice(-4)}.</p>
          <button
            type="button"
            className="btn btn-outline btn-block"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api<{ payload: string; signers: { credential_id: string; public_key_p256: string; transports: string[] }[] }>("POST", "/onboarding/test-payment/refund");
                const signed = await signWithPasskey(r.payload, r.signers, rpId());
                await api("POST", "/onboarding/test-payment/refund/submit", { signed });
                setT((await api<{ test_payment: TestPaymentView }>("GET", "/onboarding/test-payment")).test_payment);
              })
            }
          >
            <RotateCcw size={16} strokeWidth={1.5} /> Refund my $2
          </button>
        </div>
      )}

      {t?.refund_status && (
        <p className={t.refunded ? "ob-ok ob-confirmed" : "ob-muted"} aria-live="polite">
          {t.refunded ? (
            <>
              <Check size={16} strokeWidth={1.5} /> Refunded to your Base wallet.
            </>
          ) : (
            "Refund on its way to your Base wallet…"
          )}
        </p>
      )}

      {error && <p className="ob-error">{error}</p>}
      {t?.refund_status ? (
        <Continue onClick={() => next()} />
      ) : (
        <div className="ob-skip">
          <button type="button" className="ob-link" onClick={() => void next(true)}>
            Skip for now
          </button>
        </div>
      )}
    </>
  );
}

// --- live -----------------------------------------------------------------------------------

function Live({ m, setM }: StepProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = `${PAY_BASE}/${m.handle}`;
  const svg = useMemo(() => qrSvg(link), [link]);

  useEffect(() => {
    if (m.live) return;
    api<{ merchant: Merchant }>("POST", "/onboarding/live")
      .then(r => setM(r.merchant))
      .catch(e => setError(e instanceof ApiError ? e.message : "Couldn't finish setting up."));
  }, [m.live, setM]);

  return (
    <>
      <Title lead="Share your link and start taking payments. Customers pay from any wallet, on any chain.">You’re live</Title>
      {error && <p className="ob-error">{error}</p>}
      <div className="ob-live">
        <div className="ob-qr ob-qr-large" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="ob-live-link">
          {PAY_BASE.replace(/^https?:\/\//, "")}/<wbr />
          {m.handle}
        </p>
        <div className="ob-row">
          <button
            type="button"
            className="btn btn-accent"
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />} {copied ? "Copied" : "Copy link"}
          </button>
          <button type="button" className="btn btn-outline" onClick={async () => download(await qrPng(link), `morva-${m.handle}-qr.png`)}>
            <Download size={16} strokeWidth={1.5} /> PNG
          </button>
          <button type="button" className="btn btn-outline" onClick={() => download(new Blob([svg], { type: "image/svg+xml" }), `morva-${m.handle}-qr.svg`)}>
            <Download size={16} strokeWidth={1.5} /> SVG
          </button>
        </div>
      </div>
      <div className="ob-next">
        <h2 className="ob-next-title">Next</h2>
        <a className="ob-next-item" href="/dashboard/links/new">
          <span className="ob-option-title">Create a product or payment link</span>
          <span className="ob-option-body">Set a fixed price, or let customers enter an amount.</span>
        </a>
        <a className="ob-next-item" href="/dashboard">
          <span className="ob-option-title">Go to your dashboard</span>
          <span className="ob-option-body">See your balance and orders, and finish anything you skipped.</span>
        </a>
      </div>
    </>
  );
}
