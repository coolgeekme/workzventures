import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Coins, ArrowLeft, ArrowClockwise, Sparkle, Camera, Download, FloppyDisk,
  Upload, CheckCircle, Warning, Clock, X,
} from "@phosphor-icons/react";
import { api, API } from "../lib/api";
import { useAuth } from "../lib/auth";

// -------- helpers --------
function fmtUsd(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}
function confPill(conf) {
  const cls = conf === "high" ? "pill-positive" : conf === "medium" ? "pill-gold" : "pill-amber";
  return <span className={`pill ${cls}`} data-testid="wb-confidence-pill">{conf || "—"}</span>;
}

// Method → editable field spec (backend key, label, hint, type)
const METHOD_TABS = [
  { key: "summary", label: "Summary" },
  { key: "recent_transaction", label: "Recent Transaction" },
  { key: "market_multiples", label: "Market Multiples" },
  { key: "vc_method", label: "VC Method" },
  { key: "dcf", label: "DCF" },
  { key: "option_pricing", label: "Option Pricing" },
];

const METHOD_FIELDS = {
  recent_transaction: [
    { k: "round_type", label: "Round type", type: "text", placeholder: "Series B" },
    { k: "announced", label: "Announced", type: "text", placeholder: "2024-11" },
    { k: "raised_usd", label: "Raised (USD)", type: "number", money: true },
    { k: "post_money_usd", label: "Post-money (USD)", type: "number", money: true },
    { k: "time_decay_factor", label: "Time-decay factor", type: "number", step: "0.05", hint: "1.0 = fresh · 0.65 = ~18mo · 0.4 = ~30mo" },
  ],
  market_multiples: [
    { k: "comparable_tickers", label: "Comparable tickers (comma sep)", type: "list" },
    { k: "multiple_type", label: "Multiple type", type: "select", options: ["EV/Revenue", "EV/EBITDA"] },
    { k: "median_multiple", label: "Median multiple", type: "number", step: "0.1", suffix: "x" },
    { k: "estimated_annual_revenue_usd", label: "Est. annual revenue (USD)", type: "number", money: true },
    { k: "size_discount_pct", label: "Size discount %", type: "number", step: "1", suffix: "%", hint: "0-30% typical for private discount" },
  ],
  vc_method: [
    { k: "projected_exit_revenue_usd", label: "Projected exit revenue (USD)", type: "number", money: true },
    { k: "exit_multiple", label: "Exit multiple", type: "number", step: "0.5", suffix: "x" },
    { k: "years_to_exit", label: "Years to exit", type: "number", step: "1", suffix: "y" },
    { k: "target_irr_pct", label: "Target IRR", type: "number", step: "1", suffix: "%" },
    { k: "current_ownership_pct", label: "Current ownership", type: "number", step: "1", suffix: "%", hint: "leave blank to value the whole company" },
  ],
  dcf: [
    { k: "year1_revenue_usd", label: "Year-1 revenue (USD)", type: "number", money: true },
    { k: "revenue_growth_pct", label: "Revenue growth (compounded)", type: "number", step: "1", suffix: "%" },
    { k: "ebitda_margin_pct", label: "EBITDA margin", type: "number", step: "1", suffix: "%" },
    { k: "capex_pct_revenue", label: "Capex % of revenue", type: "number", step: "0.5", suffix: "%" },
    { k: "tax_rate_pct", label: "Effective tax rate", type: "number", step: "1", suffix: "%" },
    { k: "terminal_growth_pct", label: "Terminal growth (long-run)", type: "number", step: "0.1", suffix: "%" },
    { k: "wacc_pct", label: "WACC", type: "number", step: "0.5", suffix: "%", hint: "must exceed terminal growth" },
  ],
  option_pricing: [
    { k: "enterprise_value_usd", label: "Enterprise value (USD)", type: "number", money: true },
    { k: "total_preferred_liquidation_pref_usd", label: "Preferred liquidation pref (USD)", type: "number", money: true },
    { k: "volatility_pct", label: "Volatility σ", type: "number", step: "1", suffix: "%", hint: "30-90% typical" },
    { k: "time_to_liquidity_years", label: "Time to liquidity", type: "number", step: "0.5", suffix: "y" },
    { k: "risk_free_rate_pct", label: "Risk-free rate", type: "number", step: "0.25", suffix: "%" },
    { k: "common_share_pct", label: "Your common stake %", type: "number", step: "1", suffix: "%", hint: "leave blank for whole common class" },
  ],
};

export default function ValuationWorkbench() {
  const { id } = useParams();
  const { user } = useAuth();
  const [v, setV] = useState(null);
  const [tab, setTab] = useState("summary");
  const [saving, setSaving] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [snapModal, setSnapModal] = useState(false);
  const pollRef = useRef(null);
  const pollAttemptsRef = useRef(0);
  const [pollSlow, setPollSlow] = useState(false);

  const load = useCallback(async () => {
    const r = await api.get(`/valuations/${id}`);
    setV(r.data);
  }, [id]);

  const loadSnapshots = useCallback(async () => {
    try {
      const r = await api.get(`/valuations/${id}/snapshots`);
      setSnapshots(r.data);
    } catch { /* empty */ }
  }, [id]);

  useEffect(() => { load(); loadSnapshots(); }, [load, loadSnapshots]);

  // Poll autofill status while pending — cap at 40 attempts (~2 min) so a hung
  // job never runs forever. After 15 attempts (~45s) flag the UI as "slow".
  useEffect(() => {
    if (!v || v.autofill_status !== "pending") return;
    pollAttemptsRef.current = 0;
    setPollSlow(false);
    pollRef.current = setInterval(async () => {
      pollAttemptsRef.current += 1;
      if (pollAttemptsRef.current > 15) setPollSlow(true);
      if (pollAttemptsRef.current > 40) {
        clearInterval(pollRef.current);
        toast.error("Autofill is taking longer than expected — try Re-autofill.");
        return;
      }
      try {
        const r = await api.get(`/valuations/${id}/autofill/status`);
        if (r.data.autofill_status !== "pending") {
          clearInterval(pollRef.current);
          load();
          if (r.data.autofill_status === "completed") {
            toast.success("AI autofill complete — review and tune assumptions.");
          } else if (r.data.autofill_status === "failed") {
            toast.error("Autofill failed — enter inputs manually.");
          }
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [v, id, load]);

  // Merge a partial input change and save + recompute (debounced by user via explicit save)
  const [dirty, setDirty] = useState({});
  const setField = (method, field, value) => {
    setDirty((d) => ({ ...d, [method]: { ...(d[method] || {}), [field]: value } }));
  };
  const currentValue = (method, field) => {
    if (dirty[method] && field in dirty[method]) return dirty[method][field];
    return v?.inputs?.[method]?.[field] ?? "";
  };
  const saveInputs = async () => {
    if (Object.keys(dirty).length === 0) { toast.info("No changes"); return; }
    setSaving(true);
    try {
      const r = await api.patch(`/valuations/${id}`, { inputs: dirty });
      setV((prev) => ({ ...prev, inputs: r.data.inputs, outputs: r.data.outputs, aggregate: r.data.aggregate }));
      setDirty({});
      toast.success("Inputs saved · recomputed");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const rerunAutofill = async () => {
    setRerunning(true);
    try {
      await api.post(`/valuations/${id}/autofill`);
      toast.info("Autofill queued — polling for results…");
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Autofill failed");
    } finally {
      setRerunning(false);
    }
  };

  const uploadTermSheet = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    try {
      const r = await api.post(`/valuations/${id}/term-sheet`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`Term sheet extracted (${r.data.extracted?.confidence || "low"} confidence)`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Extract failed");
    } finally {
      setUploading(false);
    }
  };

  const createSnapshot = async (label, narrative) => {
    setSnapshotting(true);
    try {
      const r = await api.post(`/valuations/${id}/snapshots`, { label, narrative });
      toast.success(`Snapshot created · ${r.data.label}`);
      setSnapModal(false);
      loadSnapshots();
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Snapshot failed");
    } finally {
      setSnapshotting(false);
    }
  };

  const downloadPdf = async (sid) => {
    try {
      const token = user?.token || localStorage.getItem("wz_token");
      const resp = await fetch(`${API}/valuations/${id}/snapshots/${sid}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ValuationMemo_${v.company_name.replace(/\W+/g, "_")}_${sid.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Memo downloaded");
    } catch (e) {
      toast.error("PDF export failed");
    }
  };

  if (!v) return <div className="wz-card p-8 text-sm text-[var(--wz-text-tertiary)]">Loading valuation…</div>;

  const agg = v.aggregate || {};
  const isPending = v.autofill_status === "pending";
  const outputs = v.outputs || {};

  return (
    <div className="space-y-6" data-testid="valuation-workbench">
      <div>
        <Link to="/app/valuations" className="text-xs text-[var(--wz-text-tertiary)] hover:text-[var(--wz-gold)] flex items-center gap-1 mb-2">
          <ArrowLeft size={12} /> All valuations
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="overline text-[var(--wz-gold)] flex items-center gap-1"><Coins size={11} /> Valuation Workbench</div>
            <h1 className="font-display text-4xl tracking-tight">{v.company_name}</h1>
            <div className="text-xs text-[var(--wz-text-tertiary)] mt-1">
              {v.sector || "—"} {v.headquarters ? `· ${v.headquarters}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={rerunAutofill}
              disabled={rerunning || isPending}
              className="wz-btn wz-btn-secondary text-xs flex items-center gap-1"
              data-testid="wb-rerun-autofill"
            >
              <Sparkle size={12} /> {isPending || rerunning ? "Autofilling…" : "Re-autofill"}
            </button>
            <label className="wz-btn wz-btn-secondary text-xs flex items-center gap-1 cursor-pointer" data-testid="wb-upload-termsheet-label">
              <Upload size={12} /> {uploading ? "Extracting…" : "Term sheet"}
              <input
                type="file"
                className="hidden"
                accept=".pdf,.docx,.doc,.txt"
                onChange={(e) => e.target.files?.[0] && uploadTermSheet(e.target.files[0])}
                disabled={uploading}
                data-testid="wb-upload-termsheet-input"
              />
            </label>
            <button
              onClick={saveInputs}
              disabled={saving || Object.keys(dirty).length === 0}
              className="wz-btn wz-btn-secondary text-xs flex items-center gap-1"
              data-testid="wb-save-inputs"
            >
              <FloppyDisk size={12} /> {saving ? "Saving…" : `Save${Object.keys(dirty).length ? ` (${Object.keys(dirty).length})` : ""}`}
            </button>
            <button
              onClick={() => setSnapModal(true)}
              disabled={!agg.base_usd}
              className="wz-btn wz-btn-gold text-xs flex items-center gap-1"
              data-testid="wb-create-snapshot"
            >
              <Camera size={12} /> Snapshot
            </button>
          </div>
        </div>
      </div>

      {/* Autofill in progress banner */}
      {isPending && (
        <div className="wz-card p-4 border-l-4 border-[var(--wz-gold)]" data-testid="wb-autofill-banner">
          <div className="flex items-center gap-3">
            <div className="dot-blink" />
            <div>
              <div className="text-sm font-medium">
                {pollSlow ? "Autofill is taking longer than usual…" : "AI autofill in progress"}
              </div>
              <div className="text-xs text-[var(--wz-text-tertiary)] mt-0.5">
                {pollSlow
                  ? "Still working — click Re-autofill if it doesn't finish in another ~30s."
                  : "Grounding on Perplexity + Brave. Usually ~20-40s."}
              </div>
            </div>
          </div>
        </div>
      )}
      {v.autofill_status === "failed" && (
        <div className="wz-card p-4 border-l-4 border-[var(--wz-negative)]" data-testid="wb-autofill-failed">
          <div className="flex items-center gap-2">
            <Warning size={14} className="text-[var(--wz-negative)]" />
            <div className="text-sm">Autofill failed. Enter inputs manually or click <b>Re-autofill</b>.</div>
          </div>
        </div>
      )}

      {/* Aggregate band */}
      <div className="wz-card p-5" data-testid="wb-aggregate">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="overline">Fair-value range · USD</div>
            {agg.base_usd ? (
              <>
                <div className="font-display text-5xl tracking-tight text-[var(--wz-gold)] mt-1" data-testid="wb-base-value">
                  {fmtUsd(agg.base_usd)}
                </div>
                <div className="text-sm text-[var(--wz-text-secondary)] mt-1">
                  {fmtUsd(agg.low_usd)} — {fmtUsd(agg.high_usd)}
                </div>
              </>
            ) : (
              <div className="text-sm text-[var(--wz-text-tertiary)] mt-2">
                No value yet — {isPending ? "autofill in progress." : "fill in a method to compute."}
              </div>
            )}
          </div>
          <div className="text-right flex flex-col items-end gap-2">
            {confPill(agg.confidence)}
            {agg.included_methods && (
              <div className="text-[10px] text-[var(--wz-text-tertiary)] font-mono-wz">
                {agg.included_methods.length} of 5 methods
              </div>
            )}
          </div>
        </div>
        {agg.summary && (
          <p className="mt-4 text-xs text-[var(--wz-text-secondary)] leading-relaxed" data-testid="wb-summary">{agg.summary}</p>
        )}
        {v.narrative && (
          <div className="mt-4 pt-4 border-t border-[var(--wz-border)] text-xs italic text-[var(--wz-text-secondary)]" data-testid="wb-narrative">
            {v.narrative}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--wz-border)] flex overflow-x-auto" data-testid="wb-tabs">
        {METHOD_TABS.map((t) => {
          const out = outputs[t.key];
          const hasVal = out && out.value_usd;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-xs font-mono-wz uppercase tracking-wider border-b-2 transition-colors ${
                tab === t.key ? "border-[var(--wz-gold)] text-[var(--wz-gold)]" : "border-transparent text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text-primary)]"
              }`}
              data-testid={`wb-tab-${t.key}`}
            >
              {t.label}
              {t.key !== "summary" && hasVal && <CheckCircle size={10} className="inline ml-1 text-[var(--wz-positive)]" />}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === "summary" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="wb-tab-content-summary">
          {METHOD_TABS.filter((t) => t.key !== "summary").map((t) => {
            const out = outputs[t.key] || {};
            const w = agg.weights_used?.[t.key];
            return (
              <div key={t.key} className="wz-card p-4" data-testid={`wb-summary-card-${t.key}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="font-display tracking-tight text-sm">{t.label}</div>
                  {w !== undefined && <span className="pill pill-gold text-[10px]">weight {(w * 100).toFixed(0)}%</span>}
                </div>
                <div className="font-mono-wz text-xl">{fmtUsd(out.value_usd)}</div>
                <div className="text-[11px] text-[var(--wz-text-tertiary)] mt-2">{out.notes || "—"}</div>
                <button onClick={() => setTab(t.key)} className="text-[10px] text-[var(--wz-gold)] hover:underline mt-2">
                  Edit inputs →
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab !== "summary" && (
        <MethodEditor
          methodKey={tab}
          fields={METHOD_FIELDS[tab] || []}
          output={outputs[tab] || {}}
          getVal={currentValue}
          setVal={setField}
          dirty={dirty[tab] || {}}
        />
      )}

      {/* Snapshots panel */}
      {snapshots.length > 0 && (
        <div className="wz-card p-5" data-testid="wb-snapshots-panel">
          <div className="overline mb-3">Snapshots ({snapshots.length})</div>
          <div className="space-y-2">
            {snapshots.map((s) => (
              <div key={s.id} className="flex items-center justify-between border-b border-[var(--wz-border)] pb-2 last:border-0 last:pb-0" data-testid={`wb-snapshot-row-${s.id}`}>
                <div>
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-[10px] text-[var(--wz-text-tertiary)] font-mono-wz">
                    {s.created_at.slice(0, 16).replace("T", " ")} · {fmtUsd(s.aggregate?.base_usd)}
                  </div>
                </div>
                <button
                  onClick={() => downloadPdf(s.id)}
                  className="wz-btn wz-btn-secondary text-xs flex items-center gap-1"
                  data-testid={`wb-snapshot-pdf-${s.id}`}
                >
                  <Download size={11} /> Memo PDF
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {snapModal && (
        <SnapshotModal
          onClose={() => setSnapModal(false)}
          onSave={createSnapshot}
          creating={snapshotting}
          suggestedLabel={`Snapshot ${(v.snapshot_count || 0) + 1}`}
        />
      )}
    </div>
  );
}

function MethodEditor({ methodKey, fields, output, getVal, setVal, dirty }) {
  const val = output.value_usd;
  return (
    <div className="wz-card p-5" data-testid={`wb-editor-${methodKey}`}>
      <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
        <div>
          <div className="overline">Computed value</div>
          <div className="font-display text-3xl tracking-tight text-[var(--wz-gold)]" data-testid={`wb-editor-value-${methodKey}`}>
            {val ? fmtUsd(val) : "—"}
          </div>
        </div>
        {Object.keys(dirty).length > 0 && (
          <span className="pill pill-amber text-[10px]">unsaved · click Save to recompute</span>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fields.map((f) => (
          <FieldInput key={f.k} f={f} val={getVal(methodKey, f.k)} onChange={(v) => setVal(methodKey, f.k, v)} />
        ))}
      </div>
      {output.notes && (
        <div className="mt-4 pt-4 border-t border-[var(--wz-border)] text-xs text-[var(--wz-text-secondary)] leading-relaxed">
          {output.notes}
        </div>
      )}
    </div>
  );
}

function FieldInput({ f, val, onChange }) {
  if (f.type === "select") {
    return (
      <div>
        <label className="overline block mb-1">{f.label}</label>
        <select
          value={val ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="wz-input w-full text-sm"
          data-testid={`wb-field-${f.k}`}
        >
          <option value="">—</option>
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {f.hint && <div className="text-[10px] text-[var(--wz-text-tertiary)] mt-1">{f.hint}</div>}
      </div>
    );
  }
  if (f.type === "list") {
    return (
      <div className="md:col-span-2">
        <label className="overline block mb-1">{f.label}</label>
        <input
          type="text"
          value={Array.isArray(val) ? val.join(", ") : (val ?? "")}
          placeholder="BILL, TOST, HUBS"
          onChange={(e) => onChange(e.target.value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean))}
          className="wz-input w-full text-sm"
          data-testid={`wb-field-${f.k}`}
        />
        {f.hint && <div className="text-[10px] text-[var(--wz-text-tertiary)] mt-1">{f.hint}</div>}
      </div>
    );
  }
  return (
    <div>
      <label className="overline block mb-1">{f.label}</label>
      <div className="relative">
        <input
          type={f.type}
          step={f.step}
          value={val ?? ""}
          placeholder={f.placeholder}
          onChange={(e) => {
            const v = e.target.value;
            onChange(f.type === "number" ? (v === "" ? "" : Number(v)) : v);
          }}
          className={`wz-input w-full text-sm ${f.suffix ? "pr-6" : ""}`}
          data-testid={`wb-field-${f.k}`}
        />
        {f.suffix && !f.money && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--wz-text-tertiary)] font-mono-wz">{f.suffix}</span>
        )}
      </div>
      {f.hint && <div className="text-[10px] text-[var(--wz-text-tertiary)] mt-1">{f.hint}</div>}
    </div>
  );
}

function SnapshotModal({ onClose, onSave, creating, suggestedLabel }) {
  const [label, setLabel] = useState(suggestedLabel);
  const [narrative, setNarrative] = useState("");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !creating && onClose()}
      data-testid="wb-snapshot-modal"
    >
      <div className="wz-card max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="font-display tracking-tight text-lg">Freeze snapshot</div>
            <div className="text-xs text-[var(--wz-text-secondary)] mt-1">
              Immutable version of the current inputs + outputs. Auditable and PDF-exportable.
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--wz-text-tertiary)]"><X size={16} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="overline block mb-1">Label</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className="wz-input w-full text-sm" data-testid="wb-snapshot-label" />
          </div>
          <div>
            <label className="overline block mb-1">Narrative (optional)</label>
            <textarea rows={4} value={narrative} onChange={(e) => setNarrative(e.target.value)} className="wz-input w-full text-sm" placeholder="Q1 2026 valuation reflecting the June Series F and updated multiples…" data-testid="wb-snapshot-narrative" />
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={creating} className="wz-btn wz-btn-secondary text-xs">Cancel</button>
          <button type="button" onClick={() => onSave(label, narrative)} disabled={creating} className="wz-btn wz-btn-gold text-xs flex items-center gap-2" data-testid="wb-snapshot-save">
            <Camera size={12} /> {creating ? "Freezing…" : "Freeze snapshot"}
          </button>
        </div>
      </div>
    </div>
  );
}
