"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, Plus } from "lucide-react";
import { PAYOUT_CHAINS, validatePayoutAddress } from "@morva/domain";
import { addBackupDevice, api, ApiError, changePayout, passkeyMessage, type Merchant, type PayoutChange } from "../../start/client";
import { PageHead, PAY_BASE, shortDate, useSession } from "../_ui";

/** Saves a patch to one of the onboarding endpoints and reports how it went. */
function useSave(path: string) {
  const { setM } = useSession();
  const [state, setState] = useState<{ busy: boolean; error: string | null; saved: boolean }>({ busy: false, error: null, saved: false });
  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      setState({ busy: true, error: null, saved: false });
      try {
        setM((await api<{ merchant: Merchant }>("PATCH", path, patch)).merchant);
        setState({ busy: false, error: null, saved: true });
        window.setTimeout(() => setState(s => ({ ...s, saved: false })), 2000);
      } catch (e) {
        setState({ busy: false, error: e instanceof ApiError ? e.message : "Couldn’t save. Check your connection.", saved: false });
      }
    },
    [path, setM],
  );
  return { ...state, save };
}

function Saved({ busy, saved, error }: { busy: boolean; saved: boolean; error: string | null }) {
  if (error) return <span className="db-error">{error}</span>;
  if (busy) return <span className="db-sub">Saving…</span>;
  if (saved)
    return (
      <span className="db-ok">
        <Check size={14} strokeWidth={1.5} /> Saved
      </span>
    );
  return null;
}

export default function SettingsPage() {
  return (
    <>
      <PageHead title="Settings" />
      <div className="db-settings">
        <Business />
        <Payout />
        <Defaults />
        <Devices />
        <Account />
      </div>
    </>
  );
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="db-card db-set">
      <div className="db-set-head">
        <h2 className="db-h3">{title}</h2>
        {lead && <p className="db-sub">{lead}</p>}
      </div>
      <div className="db-set-body">{children}</div>
    </section>
  );
}

function Business() {
  const { m, setM } = useSession();
  const [name, setName] = useState(m.business_name ?? "");
  const s = useSave("/onboarding/business");
  const [logoError, setLogoError] = useState<string | null>(null);

  return (
    <Section id="business" title="Business" lead="What customers see when they pay you.">
      <label className="field">
        Business name
        <input value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== m.business_name && void s.save({ business_name: name.trim() })} />
      </label>
      <div className="field">
        Your link
        <span className="db-readonly db-mono">
          {PAY_BASE.replace(/^https?:\/\//, "")}/{m.handle}
        </span>
        <span className="db-sub">Your link name can’t change, so links you’ve shared keep working.</span>
      </div>
      <div className="field">
        Logo
        <div className="db-logo-row">
          {m.logo_url ? <img src={m.logo_url} alt="" width={48} height={48} className="db-logo" /> : <span className="db-logo" />}
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
                  setLogoError(err instanceof ApiError ? err.message : "Couldn’t upload. Try again.");
                }
              }}
            />
          </label>
          <span className="db-sub">PNG, JPG or WebP, up to 256 KB.</span>
        </div>
        {logoError && <span className="db-error">{logoError}</span>}
      </div>
      <Saved {...s} />
    </Section>
  );
}

function Payout() {
  const { m, setM } = useSession();
  const [mode, setMode] = useState(m.payout_mode);
  const [chain, setChain] = useState(m.payout_chain ?? "base");
  const [address, setAddress] = useState(m.payout_address ?? "");
  const draft = useSave("/onboarding/payout");
  // Once live, changing where money goes needs the passkey; before that it's still setup.
  const [signing, setSigning] = useState<{ busy: boolean; error: string | null; saved: boolean }>({ busy: false, error: null, saved: false });
  const s = m.live ? signing : draft;
  const submit = async (change: PayoutChange) => {
    if (!m.live) return draft.save(change);
    setSigning({ busy: true, error: null, saved: false });
    try {
      setM(await changePayout(change));
      setSigning({ busy: false, error: null, saved: true });
    } catch (e) {
      setSigning({ busy: false, error: e instanceof ApiError ? e.message : passkeyMessage(e), saved: false });
    }
  };
  const check = address ? validatePayoutAddress(chain, address) : null;
  const changed = mode !== m.payout_mode || (mode === "auto_payout" && (chain !== m.payout_chain || address !== (m.payout_address ?? "")));
  const ready = mode === "keep_in_balance" || Boolean(check?.ok);

  return (
    <Section id="payout" title="How you get paid">
      <div className="db-seg" role="radiogroup" aria-label="How you get paid">
        <button type="button" role="radio" aria-checked={mode === "keep_in_balance"} onClick={() => setMode("keep_in_balance")}>
          Keep in my balance
        </button>
        <button type="button" role="radio" aria-checked={mode === "auto_payout"} onClick={() => setMode("auto_payout")}>
          Send to my wallet
        </button>
      </div>
      {mode === "keep_in_balance" ? (
        <p className="db-sub">Payments collect as USDC in your balance. Withdraw to any chain whenever you like.</p>
      ) : (
        <>
          <label className="field">
            Network
            <select value={chain} onChange={e => setChain(e.target.value)}>
              {PAYOUT_CHAINS.map(c => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Wallet address
            <input value={address} spellCheck={false} autoCapitalize="none" onChange={e => setAddress(e.target.value)} />
            {check && !check.ok && <span className="db-error">{check.message}</span>}
          </label>
          <p className="db-warning">Refunds after payment won’t be possible from Morva. Use holds if you may need to refund.</p>
        </>
      )}
      <div className="db-set-actions">
        <Saved {...s} />
        <button
          type="button"
          className="btn btn-accent btn-small"
          disabled={!changed || !ready || s.busy}
          onClick={() => void submit(mode === "keep_in_balance" ? { mode } : { mode, chain, address: (check as { address: string }).address })}
        >
          {m.live ? "Confirm with passkey" : "Save"}
        </button>
      </div>
    </Section>
  );
}

function Toggle({ on, onChange, title, body }: { on: boolean; onChange: (v: boolean) => void; title: string; body: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="db-toggle" onClick={() => onChange(!on)}>
      <span>
        <span className="db-strong">{title}</span>
        <span className="db-sub">{body}</span>
      </span>
      <span className="db-switch" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

function Defaults() {
  const { m } = useSession();
  const s = useSave("/onboarding/defaults");
  return (
    <Section id="defaults" title="Order defaults" lead="Apply to new orders. You can change them per order.">
      <Toggle on={m.hold_by_default} onChange={v => void s.save({ hold_by_default: v })} title="Hold payments until delivery" body="Money waits in escrow until you capture it." />
      <Toggle
        on={m.refund_policy_default === "full_to_source"}
        onChange={v => void s.save({ refund_policy_default: v ? "full_to_source" : "none" })}
        title="Refund to the buyer’s original chain"
        body="Refunds go back as the token and chain the buyer paid with."
      />
      <Toggle
        on={m.confidential_default}
        onChange={v => void s.save({ confidential_default: v })}
        title="Confidential mode"
        body="Payment details stay out of public view where NEAR Intents supports it."
      />
      <Saved {...s} />
    </Section>
  );
}

interface Device {
  id: string;
  device_label: string | null;
  backed_up: boolean;
  on_balance: boolean;
  created_at: string;
  last_used_at: string | null;
}

function Devices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<{ passkeys: Device[] }>("GET", "/me/passkeys")
      .then(r => setDevices(r.passkeys))
      .catch(() => setDevices([]));
  }, []);
  useEffect(load, [load]);

  return (
    <Section id="devices" title="Devices" lead="Passkeys that can open your balance. Two is safer: if one device is lost, the other still works.">
      <ul className="db-devices">
        {(devices ?? []).map(d => (
          <li key={d.id}>
            <KeyRound size={18} strokeWidth={1.5} />
            <span>
              <span className="db-strong">{d.device_label ?? "Passkey"}</span>
              <span className="db-sub">
                Added {shortDate(new Date(d.created_at))}
                {d.last_used_at ? ` · last used ${shortDate(new Date(d.last_used_at))}` : ""}
                {!d.on_balance ? " · not yet active on your balance" : ""}
              </span>
            </span>
          </li>
        ))}
        {devices?.length === 0 && <li className="db-sub">No passkey yet. Create one in setup to open your balance.</li>}
      </ul>
      {devices && devices.length === 1 && <p className="db-warning">Without a backup, losing this device means losing access to your balance. Withdrawals over $100 need one.</p>}
      {error && <p className="db-error">{error}</p>}
      {devices && devices.length > 0 && (
        <button
          type="button"
          className="btn btn-outline btn-small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await addBackupDevice(process.env.NEXT_PUBLIC_RP_ID ?? window.location.hostname);
              load();
            } catch (e) {
              setError(e instanceof ApiError ? e.message : passkeyMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Plus size={16} strokeWidth={1.5} /> {busy ? "Adding…" : "Add a device"}
        </button>
      )}
    </Section>
  );
}

function Account() {
  const { m } = useSession();
  return (
    <Section id="account" title="Account">
      <div className="field">
        Email
        <span className="db-readonly">{m.contact_email ?? "Not set"}</span>
        <span className="db-sub">
          For sign-in, receipts and payout notices. It can never move your money.{m.google_linked ? " Linked to Google." : ""}
        </span>
      </div>
      <div className="field">
        Balance account
        <span className="db-readonly db-mono">{m.intents_account_id ?? "Created with your passkey"}</span>
        <span className="db-sub">Your NEAR Intents account. Only your passkeys can sign for it.</span>
      </div>
    </Section>
  );
}
