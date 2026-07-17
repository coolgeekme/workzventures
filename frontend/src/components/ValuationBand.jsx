import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Coins, Sparkle, ArrowClockwise, CaretDown, CaretUp } from "@phosphor-icons/react";
import { api } from "../lib/api";

// Compact USD formatter — $12.4M / $850K / $1.2B
function fmtUsd(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function confidencePill(conf) {
  const cls = conf === "high" ? "pill-positive" : conf === "medium" ? "pill-gold" : "pill-amber";
  return <span className={`pill ${cls}`} data-testid="valuation-confidence-pill">{conf} confidence</span>;
}

// Compact source-provider badge
function providerBadge(p) {
  const label = p === "perplexity" ? "PPLX" : p === "brave" ? "BRV" : (p || "src").toUpperCase();
  return <span className="font-mono-wz text-[10px] text-[var(--wz-text-tertiary)]">{label}</span>;
}

/**
 * Fair-value band widget for a Research Hub brief.
 *
 * Props:
 *  - companyName (string, required)
 *  - sector, oneLiner, estimatedRevenue, headquarters, researchId (optional context)
 *  - slug (optional) — if the caller already knows the slug, we can skip lookup
 */
export default function ValuationBand({
  companyName,
  sector,
  oneLiner,
  estimatedRevenue,
  headquarters,
  researchId,
}) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const slugify = (n) => (n || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

  // On mount, check for a cached valuation. If none, show the "Generate" CTA
  // instead of auto-running (a 20-30s Claude call would slow every brief load).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get(`/valuation/estimate/${slugify(companyName)}`);
        if (!cancelled) setState({ loading: false, data: r.data, error: null });
      } catch (e) {
        if (!cancelled) {
          if (e?.response?.status === 404) {
            setState({ loading: false, data: null, error: null });
          } else {
            setState({ loading: false, data: null, error: e?.response?.data?.detail || "Failed to load valuation" });
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [companyName]);

  const runEstimate = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setState((s) => ({ ...s, loading: true }));
    try {
      const r = await api.post("/valuation/estimate", {
        company_name: companyName,
        sector: sector || undefined,
        one_liner: oneLiner || undefined,
        estimated_revenue: estimatedRevenue || undefined,
        headquarters: headquarters || undefined,
        research_id: researchId || undefined,
        force_refresh: force,
      });
      setState({ loading: false, data: r.data, error: null });
      if (r.data?.aggregate?.insufficient_data) {
        toast.info("Limited public data — showing an early-stage placeholder band.");
      } else {
        toast.success(`Fair-value band ready: ${fmtUsd(r.data.aggregate?.low_usd)} – ${fmtUsd(r.data.aggregate?.high_usd)}`);
      }
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e?.response?.data?.detail || "Valuation failed" }));
      toast.error(e?.response?.data?.detail || "Valuation failed");
    } finally {
      setRefreshing(false);
    }
  }, [companyName, sector, oneLiner, estimatedRevenue, headquarters, researchId]);

  // -------------------- Empty / CTA state --------------------
  if (state.loading && !state.data) {
    return (
      <div className="px-6 py-4 border-b border-[var(--wz-border)] bg-[var(--wz-surface)]" data-testid="valuation-band-loading">
        <div className="flex items-center gap-3">
          <Coins size={16} className="text-[var(--wz-gold)]" />
          <div className="overline">Fair-value band</div>
          <div className="text-xs text-[var(--wz-text-tertiary)] flex items-center gap-2">
            <div className="dot-blink" />
            checking cache…
          </div>
        </div>
      </div>
    );
  }

  if (!state.data) {
    return (
      <div className="px-6 py-4 border-b border-[var(--wz-border)] bg-[var(--wz-surface)]" data-testid="valuation-band-empty">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Coins size={16} className="text-[var(--wz-gold)]" />
            <div>
              <div className="overline">Fair-value band</div>
              <div className="text-xs text-[var(--wz-text-secondary)] mt-0.5">
                Recent Transaction + Market Multiples · IPEV / ASC 820 methodology · ~25s
              </div>
            </div>
          </div>
          <button
            onClick={() => runEstimate(false)}
            className="wz-btn wz-btn-gold text-xs flex items-center gap-2"
            data-testid="valuation-generate-btn"
          >
            <Sparkle size={13} /> Estimate fair value
          </button>
        </div>
        {state.error && (
          <div className="mt-2 text-xs text-[var(--wz-negative)]" data-testid="valuation-band-error">{state.error}</div>
        )}
      </div>
    );
  }

  // -------------------- Populated band --------------------
  const agg = state.data.aggregate || {};
  const tx = state.data.recent_transaction || {};
  const mm = state.data.market_multiples || {};
  const sources = state.data.sources || [];
  const insufficient = !!agg.insufficient_data;

  // Band rail position: place a marker at `base` between low and high.
  const railPct = (() => {
    const lo = Number(agg.low_usd) || 0;
    const hi = Number(agg.high_usd) || 0;
    const base = Number(agg.base_usd) || 0;
    if (hi <= lo) return 50;
    return Math.min(95, Math.max(5, ((base - lo) / (hi - lo)) * 100));
  })();

  return (
    <div className="px-6 py-5 border-b border-[var(--wz-border)] bg-[var(--wz-surface)]" data-testid="valuation-band">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3">
          <Coins size={18} className="text-[var(--wz-gold)]" />
          <div>
            <div className="overline">Fair-value band · USD</div>
            <div className="text-[11px] text-[var(--wz-text-tertiary)] mt-0.5">
              As of {(state.data.as_of || "").slice(0, 10)}
              {state.data.cache_age_hours !== undefined && ` · cached ${state.data.cache_age_hours}h ago`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {confidencePill(agg.confidence || "low")}
          {insufficient && (
            <span className="pill pill-amber" data-testid="valuation-insufficient-pill">limited public data</span>
          )}
          <button
            onClick={() => runEstimate(true)}
            disabled={refreshing}
            className="wz-btn wz-btn-secondary text-xs flex items-center gap-1"
            data-testid="valuation-refresh"
            title="Regenerate with fresh web data"
          >
            <ArrowClockwise size={12} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Rail with three anchor prices */}
      <div className="mb-4" data-testid="valuation-rail">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <div className="text-[10px] text-[var(--wz-text-tertiary)]">LOW</div>
            <div className="font-mono-wz text-sm">{fmtUsd(agg.low_usd)}</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-[var(--wz-text-tertiary)]">BASE</div>
            <div className="font-display text-2xl tracking-tight text-[var(--wz-gold)]" data-testid="valuation-base">
              {fmtUsd(agg.base_usd)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-[var(--wz-text-tertiary)]">HIGH</div>
            <div className="font-mono-wz text-sm">{fmtUsd(agg.high_usd)}</div>
          </div>
        </div>
        <div className="relative h-1.5 bg-[var(--wz-border)] rounded-full">
          <div className="absolute top-0 h-full rounded-full bg-gradient-to-r from-[var(--wz-gold)]/30 via-[var(--wz-gold)] to-[var(--wz-gold)]/30" style={{ left: 0, right: 0 }} />
          <div
            className="absolute -top-1 h-3.5 w-3.5 rounded-full bg-[var(--wz-gold)] border-2 border-[var(--wz-bg)]"
            style={{ left: `calc(${railPct}% - 7px)` }}
          />
        </div>
      </div>

      {/* Method chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`pill ${tx.value_usd ? "pill-gold" : "pill-amber"} text-left`}
          data-testid="valuation-method-tx"
        >
          Recent Transaction · {tx.value_usd ? `${fmtUsd(tx.adjusted_value_usd || tx.value_usd)}` : "no data"}
          {tx.round_type && ` · ${tx.round_type}`}
          {tx.months_since !== undefined && tx.months_since !== null && ` · ${tx.months_since}mo old`}
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`pill ${mm.value_usd ? "pill-gold" : "pill-amber"} text-left`}
          data-testid="valuation-method-mm"
        >
          Market Multiples · {mm.value_usd ? fmtUsd(mm.value_usd) : "no data"}
          {mm.median_multiple && ` · ${mm.median_multiple}x`}
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className="pill pill-gold text-left flex items-center gap-1"
          data-testid="valuation-expand"
        >
          {expanded ? <CaretUp size={11} /> : <CaretDown size={11} />}
          {expanded ? "Hide workings" : "Show workings"}
        </button>
      </div>

      <p className="text-xs text-[var(--wz-text-secondary)] leading-relaxed" data-testid="valuation-summary">
        {agg.summary}
      </p>

      {/* Drawer: methodology detail + sources */}
      {expanded && (
        <div className="mt-4 border-t border-[var(--wz-border)] pt-4 grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="valuation-drawer">
          <div className="border border-[var(--wz-border)] p-4">
            <div className="overline mb-2">Recent Transaction Method</div>
            <div className="text-xs space-y-1.5 text-[var(--wz-text-secondary)]">
              <div><span className="text-[var(--wz-text-tertiary)]">Round:</span> {tx.round_type || "—"}</div>
              <div><span className="text-[var(--wz-text-tertiary)]">Announced:</span> {tx.announced || "—"}</div>
              <div><span className="text-[var(--wz-text-tertiary)]">Raised:</span> {tx.raised_usd ? fmtUsd(tx.raised_usd) : "—"}</div>
              <div><span className="text-[var(--wz-text-tertiary)]">Post-money:</span> {tx.post_money_usd ? fmtUsd(tx.post_money_usd) : "—"}</div>
              <div><span className="text-[var(--wz-text-tertiary)]">Time-decay:</span> {tx.time_decay_factor ? `${tx.time_decay_factor}x` : "—"}</div>
              <div><span className="text-[var(--wz-text-tertiary)]">Adjusted value:</span> <span className="text-[var(--wz-gold)] font-mono-wz">{tx.adjusted_value_usd ? fmtUsd(tx.adjusted_value_usd) : "—"}</span></div>
              {tx.note && <div className="pt-2 italic border-t border-[var(--wz-border)]">{tx.note}</div>}
            </div>
          </div>
          <div className="border border-[var(--wz-border)] p-4">
            <div className="overline mb-2">Market Multiples Method</div>
            <div className="text-xs space-y-1.5 text-[var(--wz-text-secondary)]">
              <div><span className="text-[var(--wz-text-tertiary)]">Comparables:</span> {(mm.comparable_tickers || []).join(", ") || "—"}</div>
              <div><span className="text-[var(--wz-text-tertiary)]">Multiple:</span> {mm.median_multiple ? `${mm.median_multiple}x ${mm.multiple_type || ""}` : "—"}</div>
              <div><span className="text-[var(--wz-text-tertiary)]">Est. revenue:</span> {mm.estimated_annual_revenue_usd ? `${fmtUsd(mm.estimated_annual_revenue_usd)}/yr` : "—"}</div>
              <div><span className="text-[var(--wz-text-tertiary)]">Basis:</span> {mm.revenue_basis || "—"}</div>
              <div><span className="text-[var(--wz-text-tertiary)]">Value:</span> <span className="text-[var(--wz-gold)] font-mono-wz">{mm.value_usd ? fmtUsd(mm.value_usd) : "—"}</span></div>
              {mm.note && <div className="pt-2 italic border-t border-[var(--wz-border)]">{mm.note}</div>}
            </div>
          </div>
          {sources.length > 0 && (
            <div className="md:col-span-2">
              <div className="overline mb-2">Sources ({sources.length})</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto" data-testid="valuation-sources">
                {sources.map((s, i) => (
                  <a
                    key={`${s.url}-${i}`}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-gold)] hover:underline truncate"
                    data-testid={`valuation-source-${i}`}
                  >
                    {providerBadge(s.provider)}
                    <span className="truncate">{s.title || s.url}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
