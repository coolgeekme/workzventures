import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Crosshair, MagnifyingGlass, ArrowSquareOut, Bell, TrashSimple,
  CheckCircle, X, ListChecks, PaperPlaneTilt, Buildings,
} from "@phosphor-icons/react";
import { api } from "../lib/api";

const SCORE_PILL = (s) => {
  if (s >= 75) return "pill-positive";
  if (s >= 50) return "pill-gold";
  return "pill-amber";
};

const FIT_BARS = ({ fit }) => {
  const keys = ["sector", "size", "geo", "cadence"];
  return (
    <div className="grid grid-cols-4 gap-2 mt-2">
      {keys.map((k) => {
        const v = Number(fit?.[k] || 0);
        return (
          <div key={k}>
            <div className="overline mb-1">{k}</div>
            <div className="h-1 bg-[var(--wz-surface-hover)] overflow-hidden rounded-sm">
              <div
                className="h-full"
                style={{ width: `${Math.min(100, v)}%`, background: "var(--wz-amber)" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default function BuyerDiscovery() {
  const [params, setParams] = useSearchParams();
  const [overview, setOverview] = useState([]);
  const [overviewLoaded, setOverviewLoaded] = useState(false);
  const [selected, setSelected] = useState(params.get("listing") || "");
  const [matches, setMatches] = useState([]);
  const [lastScan, setLastScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);

  const loadOverview = async () => {
    try {
      const r = await api.get("/buyer-discovery/overview");
      const data = r.data || [];
      setOverview(data);
      if (!selected && data.length) {
        // Prefer the listing with the most matches; fall back to the first
        const best = [...data].sort((a, b) => (b.match_count || 0) - (a.match_count || 0))[0];
        const pick = best.listing_id;
        setSelected(pick);
        setParams({ listing: pick }, { replace: true });
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load listings");
    } finally {
      setOverviewLoaded(true);
    }
  };

  const loadMatches = async (lid) => {
    if (!lid) return;
    setLoadingMatches(true);
    try {
      const r = await api.get(`/buyer-discovery/listings/${lid}/matches`);
      setMatches(r.data.matches || []);
      setLastScan(r.data.last_scan || null);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load matches");
    } finally {
      setLoadingMatches(false);
    }
  };

  useEffect(() => { loadOverview(); }, []); // eslint-disable-line
  useEffect(() => { if (selected) loadMatches(selected); }, [selected]); // eslint-disable-line

  const selectedListing = useMemo(
    () => overview.find((x) => x.listing_id === selected),
    [overview, selected],
  );

  const runScan = async () => {
    if (!selected) return;
    setScanning(true);
    const t = toast.loading("Scanning SEC EDGAR + ranking with AI…");
    try {
      const r = await api.post(`/buyer-discovery/listings/${selected}/scan`);
      toast.success(
        `${r.data.ranked_count} ranked · ${r.data.inserted} new · ${r.data.new_alerts} high-fit alerts`,
        { id: t },
      );
      await Promise.all([loadOverview(), loadMatches(selected)]);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Scan failed", { id: t });
    } finally {
      setScanning(false);
    }
  };

  const updateMatch = async (mid, status) => {
    try {
      await api.patch(`/buyer-discovery/matches/${mid}`, { status });
      setMatches((arr) => arr.map((m) => (m.id === mid ? { ...m, status } : m)));
      toast.success(`Marked ${status}`);
    } catch (err) {
      toast.error("Update failed");
    }
  };

  const deleteMatch = async (mid) => {
    if (!window.confirm("Remove this buyer from your pipeline?")) return;
    try {
      await api.delete(`/buyer-discovery/matches/${mid}`);
      setMatches((arr) => arr.filter((m) => m.id !== mid));
      toast.success("Removed");
    } catch (err) {
      toast.error("Delete failed");
    }
  };

  const addToLeads = async (mid) => {
    try {
      await api.post(`/buyer-discovery/matches/${mid}/add-to-leads`);
      setMatches((arr) => arr.map((m) => (m.id === mid ? { ...m, status: "saved" } : m)));
      toast.success("Added to Lead Nurturing");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  const generateOutreach = async (mid) => {
    const t = toast.loading("Drafting outreach campaign…");
    try {
      const r = await api.post(`/buyer-discovery/matches/${mid}/generate-outreach`);
      setMatches((arr) => arr.map((m) => (m.id === mid ? { ...m, status: "contacted" } : m)));
      toast.success(`Outreach drafted (${r.data.name})`, { id: t });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed", { id: t });
    }
  };

  return (
    <div data-testid="buyer-discovery-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="overline mb-3" style={{ color: "var(--wz-amber)" }}>
        Buyer Discovery · Phase 1
      </div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium flex items-center gap-3">
        <Crosshair size={28} className="text-[var(--wz-amber)]" />
        Find buyers for your listings
      </h1>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
        We mine SEC EDGAR 8-K filings for U.S. companies actively making acquisitions in your
        sector, then rank each candidate with Claude 4.5 against your listing. High-fit buyers
        appear as alerts and can be pushed to Lead Nurturing or auto-drafted into an outreach
        campaign.
      </p>

      {/* Listing selector strip */}
      <div className="mt-6 flex gap-2 overflow-x-auto pb-2" data-testid="listing-strip">
        {overview.map((li) => {
          const isActive = li.listing_id === selected;
          return (
            <button
              key={li.listing_id}
              onClick={() => { setSelected(li.listing_id); setParams({ listing: li.listing_id }, { replace: true }); }}
              data-testid={`listing-tab-${li.listing_id}`}
              className={`shrink-0 px-3 py-2 border text-left min-w-[180px] transition-colors ${
                isActive
                  ? "border-[var(--wz-amber)] bg-[var(--wz-surface-hover)]"
                  : "border-[var(--wz-border)] hover:border-[var(--wz-text-tertiary)]"
              }`}
            >
              <div className="text-sm font-medium truncate">{li.company_name}</div>
              <div className="overline mt-1 truncate">
                {li.sector} · {li.geography}
              </div>
              <div className="mt-2 flex items-center gap-2">
                {typeof li.top_score === "number" && (
                  <span className={`pill ${SCORE_PILL(li.top_score)}`}>top {li.top_score}</span>
                )}
                <span className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)]">
                  {li.match_count} match{li.match_count === 1 ? "" : "es"}
                </span>
              </div>
            </button>
          );
        })}
        {overview.length === 0 && overviewLoaded && (
          <div className="text-sm text-[var(--wz-text-tertiary)] py-3">
            Create a listing first under <Link to="/app/listings" className="underline">My Listings</Link>.
          </div>
        )}
        {!overviewLoaded && (
          <div className="text-sm text-[var(--wz-text-tertiary)] py-3">Loading your listings…</div>
        )}
      </div>

      {/* Action bar for selected listing */}
      {selectedListing && (
        <div className="wz-card p-4 mt-4 flex items-center justify-between flex-wrap gap-3" data-testid="scan-bar">
          <div>
            <div className="overline">selected listing</div>
            <div className="text-base font-medium mt-1 flex items-center gap-2">
              <Buildings size={14} className="text-[var(--wz-text-secondary)]" />
              {selectedListing.company_name}
            </div>
            <div className="text-xs text-[var(--wz-text-secondary)] mt-1">
              {selectedListing.sector} · {selectedListing.geography}
              {lastScan?.last_scanned_at && (
                <> · last scanned {new Date(lastScan.last_scanned_at).toLocaleString()}</>
              )}
            </div>
          </div>
          <button
            onClick={runScan}
            disabled={scanning}
            data-testid="scan-now-btn"
            className="wz-btn wz-btn-gold flex items-center gap-2"
          >
            <MagnifyingGlass size={14} /> {scanning ? "Scanning…" : "Scan SEC EDGAR now"}
          </button>
        </div>
      )}

      {/* Matches list */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="overline">Ranked buyer matches</div>
          <Link
            to="/app/buyer-alerts"
            className="text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-text)] flex items-center gap-1"
            data-testid="link-alerts"
          >
            <Bell size={12} /> Alerts inbox
          </Link>
        </div>

        {loadingMatches ? (
          <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)]">
            Loading…
          </div>
        ) : matches.length === 0 ? (
          <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)]" data-testid="empty-matches">
            {selectedListing
              ? "No matches yet — tap “Scan SEC EDGAR now” above. Periodic rescans run every 24h."
              : "Select a listing to view its buyer matches."}
          </div>
        ) : (
          <div className="space-y-3" data-testid="match-list">
            {matches.map((m) => (
              <article
                key={m.id}
                data-testid={`match-${m.id}`}
                className={`wz-card p-5 ${m.status === "dismissed" ? "opacity-50" : ""}`}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-[280px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display text-lg tracking-tight">{m.buyer_name}</h3>
                      <span className={`pill ${SCORE_PILL(m.score)}`}>{m.score}/100</span>
                      <span className="pill">{m.country}</span>
                      <span className="pill">{(m.source || "").replace("_", " ")}</span>
                      {m.status && m.status !== "new" && (
                        <span className="pill pill-amber">{m.status}</span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--wz-text-secondary)] mt-2 leading-relaxed">
                      {m.rationale}
                    </p>
                    {m.snippet && (
                      <p className="text-xs italic text-[var(--wz-text-tertiary)] mt-2 line-clamp-2">
                        {m.snippet}
                      </p>
                    )}
                    <FIT_BARS fit={m.fit} />
                    <div className="mt-3 flex items-center gap-3 flex-wrap text-xs font-mono-wz text-[var(--wz-text-tertiary)]">
                      {m.filed_at && <span>{m.form || "8-K"} · {m.filed_at}</span>}
                      {m.filing_url && (
                        <a
                          href={m.filing_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 hover:text-[var(--wz-text)] underline"
                          data-testid={`filing-link-${m.id}`}
                        >
                          SEC filing <ArrowSquareOut size={11} />
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 min-w-[160px]">
                    <button
                      onClick={() => addToLeads(m.id)}
                      data-testid={`add-lead-${m.id}`}
                      className="wz-btn-ghost wz-btn text-xs flex items-center gap-2 justify-center"
                    >
                      <ListChecks size={12} /> Add to leads
                    </button>
                    <button
                      onClick={() => generateOutreach(m.id)}
                      data-testid={`gen-outreach-${m.id}`}
                      className="wz-btn wz-btn-gold text-xs flex items-center gap-2 justify-center"
                    >
                      <PaperPlaneTilt size={12} /> Draft outreach
                    </button>
                    <div className="flex gap-1">
                      <button
                        onClick={() => updateMatch(m.id, "saved")}
                        data-testid={`save-${m.id}`}
                        className="flex-1 text-xs py-1 border border-[var(--wz-border)] hover:border-[var(--wz-text-tertiary)] flex items-center justify-center gap-1"
                      >
                        <CheckCircle size={11} /> Save
                      </button>
                      <button
                        onClick={() => updateMatch(m.id, "dismissed")}
                        data-testid={`dismiss-${m.id}`}
                        className="flex-1 text-xs py-1 border border-[var(--wz-border)] hover:border-[var(--wz-text-tertiary)] flex items-center justify-center gap-1"
                      >
                        <X size={11} /> Skip
                      </button>
                      <button
                        onClick={() => deleteMatch(m.id)}
                        data-testid={`delete-${m.id}`}
                        title="Remove"
                        className="px-2 py-1 border border-[var(--wz-border)] hover:border-[var(--wz-negative)] hover:text-[var(--wz-negative)]"
                      >
                        <TrashSimple size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
