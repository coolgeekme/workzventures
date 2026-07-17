import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Coins, ArrowRight, Sparkle, ShieldCheck } from "@phosphor-icons/react";
import { api } from "../lib/api";

function fmtUsd(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function confPill(conf) {
  const cls = conf === "high" ? "pill-positive" : conf === "medium" ? "pill-gold" : "pill-amber";
  return <span className={`pill ${cls}`} data-testid="vv-confidence">{conf}</span>;
}

/**
 * Compact "Value this target" card for a Deal Room / Vault.
 *
 * Behavior:
 *   - Mounts → GETs the current buyer's linked valuation for this vault
 *   - 404 → shows a "Value this target" CTA button
 *   - Found + pending → shows autofill spinner + poll every 3s
 *   - Found + completed → shows compact band + "Open Workbench →" link
 *
 * Only rendered for buyers who have NDA-signed the vault.
 */
export default function VaultValuationCard({ roomId, roomStatus, canCreate = true }) {
  const [state, setState] = useState({ loading: true, val: null });
  const [creating, setCreating] = useState(false);
  // Iter-42: allow both Active vaults (post-NDA buyers) AND Preview vaults
  // (sellers/admins pre-listing DD). Any other status is a disabled state.
  const disabled = roomStatus !== "active" && roomStatus !== "preview";

  const load = async () => {
    try {
      const r = await api.get(`/deal-rooms/${roomId}/valuation`);
      setState({ loading: false, val: r.data });
    } catch (e) {
      if (e?.response?.status === 404) setState({ loading: false, val: null });
      else setState({ loading: false, val: null, error: e?.response?.data?.detail });
    }
  };

  useEffect(() => { load(); }, [roomId]);

  // Iter-44: Poll autofill if pending. Extended window (6 min) to handle
  // heavy vaults where Claude takes 60-180s. Slows to 10s cadence after the
  // first minute to save resources.
  useEffect(() => {
    if (state.val?.autofill_status !== "pending") return undefined;
    let attempts = 0;
    let handle;
    let phase = "fast";

    const checkOnce = async () => {
      try {
        const r = await api.get(`/valuations/${state.val.id}/autofill/status`);
        if (r.data.autofill_status !== "pending") {
          if (handle) clearInterval(handle);
          load();
          if (r.data.autofill_status === "completed") {
            toast.success("Vault-grounded fair-value ready");
          }
          return true;
        }
      } catch { /* keep polling */ }
      return false;
    };

    const tick = async () => {
      attempts += 1;
      if (attempts > 20 && phase === "fast") {
        phase = "slow";
        clearInterval(handle);
        handle = setInterval(tick, 10000);
      }
      if (attempts > 50) {
        clearInterval(handle);
        toast.error("Vault autofill still running — open workbench to check status.");
        return;
      }
      await checkOnce();
    };
    handle = setInterval(tick, 3000);

    const onVisible = () => { if (!document.hidden) checkOnce(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (handle) clearInterval(handle);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.val?.id, state.val?.autofill_status]);

  const startValuation = async () => {
    setCreating(true);
    try {
      const r = await api.post(`/deal-rooms/${roomId}/valuation`);
      toast.info("Autofill running — grounding on the data room…");
      setState({ loading: false, val: r.data });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start valuation");
    } finally {
      setCreating(false);
    }
  };

  if (state.loading) return null;

  // No valuation yet → CTA (buyers) or "not started" message (admin viewers)
  if (!state.val) {
    if (!canCreate) {
      return (
        <div className="wz-card p-4 mb-6 flex items-center justify-between gap-3 flex-wrap opacity-70" data-testid="vault-valuation-empty-admin">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--wz-gold)]/10 rounded">
              <Coins size={18} className="text-[var(--wz-gold)]" />
            </div>
            <div>
              <div className="text-sm font-medium">No valuation on this vault yet</div>
              <div className="text-[11px] text-[var(--wz-text-tertiary)]">
                The buyer hasn&apos;t started a fair-value opinion on this data room.
              </div>
            </div>
          </div>
          <span className="pill pill-amber text-[10px]">read-only</span>
        </div>
      );
    }
    return (
      <div className="wz-card p-4 mb-6 flex items-center justify-between gap-3 flex-wrap" data-testid="vault-valuation-cta">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[var(--wz-gold)]/10 rounded">
            <Coins size={18} className="text-[var(--wz-gold)]" />
          </div>
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              Value this target
              <span className="pill pill-gold text-[10px] flex items-center gap-1">
                <ShieldCheck size={9} /> private-grounded
              </span>
            </div>
            <div className="text-[11px] text-[var(--wz-text-tertiary)]">
              Fuses this vault&apos;s disclosed documents with public web signals. ~30-45s.
            </div>
          </div>
        </div>
        <button
          onClick={startValuation}
          disabled={creating || disabled}
          title={disabled ? "Vault must be Active or in Preview" : "Kicks off AI autofill grounded on this vault"}
          className="wz-btn wz-btn-gold text-xs flex items-center gap-2"
          data-testid="vault-valuation-start"
        >
          <Sparkle size={12} /> {creating ? "Starting…" : "Start valuation"}
        </button>
      </div>
    );
  }

  const v = state.val;
  const agg = v.aggregate || {};
  const isPending = v.autofill_status === "pending";
  const isFailed = v.autofill_status === "failed";

  return (
    <Link
      to={`/app/valuations/${v.id}`}
      className="wz-card p-4 mb-6 hover:border-[var(--wz-gold)]/50 transition-colors flex items-center justify-between gap-4 flex-wrap"
      data-testid="vault-valuation-card"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-[var(--wz-gold)]/10 rounded">
          <Coins size={18} className="text-[var(--wz-gold)]" />
        </div>
        <div>
          <div className="overline flex items-center gap-2">
            Fair value
            {v.private_grounded && (
              <span className="pill pill-gold text-[10px] flex items-center gap-1" data-testid="vv-private-badge">
                <ShieldCheck size={9} /> private + web
              </span>
            )}
            {v.read_only_for_viewer && (
              <span className="pill pill-amber text-[10px]" data-testid="vv-readonly-badge">read-only</span>
            )}
          </div>
          {isPending && (
            <div className="text-sm text-[var(--wz-text-secondary)] flex items-center gap-2 mt-1">
              <div className="dot-blink" /> Autofill running…
            </div>
          )}
          {isFailed && (
            <div className="text-sm text-[var(--wz-negative)] mt-1">Autofill failed — open workbench to retry</div>
          )}
          {!isPending && !isFailed && agg.base_usd && (
            <div className="flex items-baseline gap-3 mt-0.5">
              <div className="font-display text-2xl tracking-tight text-[var(--wz-gold)]" data-testid="vv-base">
                {fmtUsd(agg.base_usd)}
              </div>
              <div className="text-[11px] text-[var(--wz-text-tertiary)] font-mono-wz">
                {fmtUsd(agg.low_usd)} – {fmtUsd(agg.high_usd)}
              </div>
              {confPill(agg.confidence)}
            </div>
          )}
          {!isPending && !isFailed && !agg.base_usd && (
            <div className="text-xs text-[var(--wz-text-tertiary)] mt-1">Draft · open workbench to enter inputs</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-[var(--wz-gold)]">
        Open Workbench <ArrowRight size={12} />
      </div>
    </Link>
  );
}
