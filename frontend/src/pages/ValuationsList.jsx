import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Coins, Plus, TrendUp, Warning, Clock, X } from "@phosphor-icons/react";
import { api } from "../lib/api";

function fmtUsd(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function relTime(iso) {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function confPill(conf) {
  const cls = conf === "high" ? "pill-positive" : conf === "medium" ? "pill-gold" : "pill-amber";
  return <span className={`pill ${cls}`}>{conf || "—"}</span>;
}

export default function ValuationsList() {
  const [items, setItems] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const nav = useNavigate();
  const load = async () => {
    try {
      const r = await api.get("/valuations");
      setItems(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load valuations");
    }
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6" data-testid="valuations-list">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="overline text-[var(--wz-gold)]">Diligence · Valuation Suite</div>
          <h1 className="font-display text-4xl sm:text-5xl tracking-tight">Fair-value opinions.</h1>
          <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
            Build defensible IPEV / ASC 820 valuations across five methods. Autofill assumptions from the web,
            tune, freeze immutable snapshots, and export a memorandum PDF for the Committee.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="wz-btn wz-btn-gold flex items-center gap-2"
          data-testid="valuations-new-btn"
        >
          <Plus size={14} /> Start valuation
        </button>
      </div>

      {items === null && (
        <div className="wz-card p-8 text-center text-sm text-[var(--wz-text-tertiary)]">Loading…</div>
      )}
      {items && items.length === 0 && (
        <div className="wz-card p-12 text-center" data-testid="valuations-empty">
          <Coins size={40} className="mx-auto text-[var(--wz-gold)] opacity-60 mb-3" />
          <div className="font-display text-lg">No valuations yet.</div>
          <div className="text-sm text-[var(--wz-text-secondary)] mt-2">
            Kick off your first fair-value opinion — takes ~30s to autofill from public sources.
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="wz-btn wz-btn-gold mt-4 text-sm"
            data-testid="valuations-empty-cta"
          >
            Start a valuation
          </button>
        </div>
      )}
      {items && items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((v) => (
            <Link
              key={v.id}
              to={`/app/valuations/${v.id}`}
              className="wz-card p-5 hover:border-[var(--wz-gold)]/50 transition-colors"
              data-testid={`valuation-card-${v.id}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-display text-lg tracking-tight">{v.company_name}</div>
                  <div className="text-xs text-[var(--wz-text-tertiary)] mt-0.5">
                    {v.sector || "—"} {v.headquarters ? ` · ${v.headquarters}` : ""}
                  </div>
                </div>
                {v.autofill_status === "pending" && (
                  <span className="pill pill-amber flex items-center gap-1 text-[10px]"><Clock size={10} /> autofilling…</span>
                )}
                {v.autofill_status === "failed" && (
                  <span className="pill pill-amber flex items-center gap-1 text-[10px]"><Warning size={10} /> autofill failed</span>
                )}
              </div>
              {v.aggregate?.base_usd ? (
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="font-display text-3xl tracking-tight text-[var(--wz-gold)]">
                      {fmtUsd(v.aggregate.base_usd)}
                    </div>
                    <div className="text-xs text-[var(--wz-text-tertiary)]">
                      {fmtUsd(v.aggregate.low_usd)} – {fmtUsd(v.aggregate.high_usd)}
                    </div>
                  </div>
                  <div className="text-right">
                    {confPill(v.aggregate.confidence)}
                    <div className="text-[10px] text-[var(--wz-text-tertiary)] mt-1">
                      {v.snapshot_count || 0} snapshot{v.snapshot_count === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[var(--wz-text-tertiary)] flex items-center gap-1">
                  <TrendUp size={12} /> No band yet — open to autofill.
                </div>
              )}
              <div className="text-[10px] text-[var(--wz-text-tertiary)] mt-3">
                Updated {relTime(v.updated_at)}
              </div>
            </Link>
          ))}
        </div>
      )}

      {showModal && (
        <NewValuationModal
          onClose={() => setShowModal(false)}
          onCreated={(v) => nav(`/app/valuations/${v.id}`)}
        />
      )}
    </div>
  );
}

function NewValuationModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ company_name: "", sector: "", one_liner: "", estimated_revenue: "", headquarters: "" });
  const [creating, setCreating] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!form.company_name.trim()) return;
    setCreating(true);
    try {
      const r = await api.post("/valuations", { ...form, autofill: true });
      toast.success(`Created — autofill running in the background.`);
      onCreated(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to create valuation");
      setCreating(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !creating && onClose()}
      data-testid="new-valuation-modal"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="wz-card max-w-lg w-full p-6"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="font-display tracking-tight text-lg">Start a valuation</div>
            <div className="text-xs text-[var(--wz-text-secondary)] mt-1">
              AI autofill will seed all five methods from public sources (~30s).
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text-primary)]" data-testid="new-valuation-close">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          {[
            { k: "company_name", label: "Company name *", placeholder: "Ramp, Anthropic, Stripe…" },
            { k: "sector", label: "Sector", placeholder: "Fintech, HealthTech, SaaS" },
            { k: "one_liner", label: "One-liner", placeholder: "Corporate cards and spend management" },
            { k: "estimated_revenue", label: "Revenue hint", placeholder: "$100M ARR" },
            { k: "headquarters", label: "Headquarters", placeholder: "San Francisco, CA" },
          ].map((f) => (
            <div key={f.k}>
              <label className="overline block mb-1">{f.label}</label>
              <input
                type="text"
                value={form[f.k]}
                placeholder={f.placeholder}
                onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}
                className="wz-input w-full text-sm"
                required={f.k === "company_name"}
                disabled={creating}
                data-testid={`new-valuation-${f.k}`}
              />
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={creating} className="wz-btn wz-btn-secondary text-xs">Cancel</button>
          <button type="submit" disabled={creating || !form.company_name.trim()} className="wz-btn wz-btn-gold text-xs flex items-center gap-2" data-testid="new-valuation-submit">
            {creating ? "Creating…" : <><Plus size={12} /> Create & autofill</>}
          </button>
        </div>
      </form>
    </div>
  );
}
