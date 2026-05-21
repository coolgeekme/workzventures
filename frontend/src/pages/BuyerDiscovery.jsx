import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Crosshair, MagnifyingGlass, ArrowSquareOut, Bell, TrashSimple,
  CheckCircle, X, ListChecks, PaperPlaneTilt, Buildings,
  IdentificationCard, LinkedinLogo, Envelope, Phone, MapPin, CaretDown, CaretUp, UserPlus,
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

  // ---- Contact resolution ---------------------------------------------------
  const [openContactsFor, setOpenContactsFor] = useState(null);
  const [loadingContactsFor, setLoadingContactsFor] = useState(null);

  const findContacts = async (mid, { refresh = false } = {}) => {
    setLoadingContactsFor(mid);
    const t = toast.loading("Parsing SEC filings for named executives…");
    try {
      const r = await api.post(`/buyer-discovery/matches/${mid}/find-contacts${refresh ? "?refresh=true" : ""}`);
      setMatches((arr) => arr.map((m) => (m.id === mid ? { ...m, contacts: r.data, contacts_resolved_at: r.data.generated_at } : m)));
      setOpenContactsFor(mid);
      const execs = (r.data.executives || []).length;
      toast.success(`Found ${execs} executive${execs === 1 ? "" : "s"} · ${(r.data.used_filings || []).length} filings parsed`, { id: t });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Contact resolution failed", { id: t });
    } finally {
      setLoadingContactsFor(null);
    }
  };

  const addContactToLeads = async (mid, idx, name) => {
    try {
      await api.post(`/buyer-discovery/matches/${mid}/contacts/${idx}/add-to-leads`);
      toast.success(`${name} added to Lead Nurturing`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  return (
    <div data-testid="buyer-discovery-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1600px] mx-auto w-full">
      <div className="overline mb-3" style={{ color: "var(--wz-amber)" }}>
        Buyer Discovery · Phase 1
      </div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium flex items-center gap-3">
        <Crosshair size={28} className="text-[var(--wz-amber)]" />
        Find buyers for your listings
      </h1>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
        We mine SEC EDGAR 8-K filings for U.S. companies actively making acquisitions in your
        sector, then rank each candidate with our AI analyst against your listing. High-fit
        buyers appear as alerts and can be pushed to Lead Nurturing or auto-drafted into an
        outreach campaign.
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
                  <div className="flex-1 basis-[260px] min-w-0">
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

                  <div className="flex flex-col gap-2 w-full sm:w-auto sm:min-w-[180px] sm:max-w-[200px]">
                    <button
                      onClick={() => {
                        if (openContactsFor === m.id) { setOpenContactsFor(null); return; }
                        if (m.contacts) { setOpenContactsFor(m.id); }
                        else { findContacts(m.id); }
                      }}
                      disabled={loadingContactsFor === m.id || !m.buyer_cik}
                      title={!m.buyer_cik ? "Non-US listing — contact resolution requires SEC EDGAR CIK" : "Parse SEC filings + LinkedIn"}
                      data-testid={`find-contacts-${m.id}`}
                      className="wz-btn-ghost wz-btn text-xs flex items-center gap-2 justify-center"
                    >
                      <IdentificationCard size={12} />
                      {loadingContactsFor === m.id
                        ? "Resolving…"
                        : m.contacts
                          ? (openContactsFor === m.id ? "Hide contacts" : `View contacts (${(m.contacts.executives || []).length})`)
                          : "Find contacts"}
                      {m.contacts && (openContactsFor === m.id ? <CaretUp size={10} /> : <CaretDown size={10} />)}
                    </button>
                    <button
                      onClick={() => addToLeads(m.id)}
                      data-testid={`add-lead-${m.id}`}
                      className="wz-btn-ghost wz-btn text-xs flex items-center gap-2 justify-center"
                    >
                      <ListChecks size={12} /> Add firm to leads
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

                {/* Resolved contacts panel */}
                {openContactsFor === m.id && m.contacts && (
                  <ContactPanel
                    contacts={m.contacts}
                    matchId={m.id}
                    onRefresh={() => findContacts(m.id, { refresh: true })}
                    onAddContact={(idx, name) => addContactToLeads(m.id, idx, name)}
                  />
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * ContactPanel — resolved IR + named executives + LinkedIn + filings
 * ========================================================================== */
const RELEVANCE_LABEL = {
  ceo: "CEO", cfo: "CFO", coo: "COO",
  corp_dev: "Corp Dev", strategy: "Strategy",
  legal: "Legal", ir: "Investor Relations", other: "Other",
};
const RELEVANCE_PILL = {
  corp_dev: "pill-positive", strategy: "pill-positive",
  cfo: "pill-gold", ceo: "pill-gold",
  legal: "pill-amber", ir: "pill-amber", other: "pill",
};

function ContactPanel({ contacts, matchId, onRefresh, onAddContact }) {
  const ir = contacts.ir_contact || {};
  const gc = contacts.general_contacts || {};
  return (
    <div
      data-testid={`contacts-panel-${matchId}`}
      className="mt-4 border-t border-[var(--wz-border)] pt-4"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="overline flex items-center gap-2">
          <IdentificationCard size={12} /> Decision-makers (from SEC filings)
        </div>
        <button
          onClick={onRefresh}
          data-testid={`refresh-contacts-${matchId}`}
          className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text)] underline"
        >
          re-scan filings
        </button>
      </div>

      {/* Firm-level intel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 text-xs">
        {contacts.hq_address && (
          <div className="border border-[var(--wz-border)] p-3">
            <div className="overline mb-1 flex items-center gap-1"><MapPin size={11} /> HQ</div>
            <div className="text-[var(--wz-text-secondary)] whitespace-pre-line leading-snug">{contacts.hq_address}</div>
          </div>
        )}
        {(contacts.switchboard_phone || ir.phone || (gc.phones || []).length > 0) && (
          <div className="border border-[var(--wz-border)] p-3">
            <div className="overline mb-1 flex items-center gap-1"><Phone size={11} /> Switchboard / IR</div>
            <div className="text-[var(--wz-text-secondary)] space-y-0.5">
              {contacts.switchboard_phone && <div>{contacts.switchboard_phone}</div>}
              {ir.phone && <div>IR · {ir.phone}</div>}
              {(gc.phones || []).slice(0, 2).map((p, i) => <div key={i}>{p}</div>)}
            </div>
          </div>
        )}
        {(ir.email || (gc.emails || []).length > 0) && (
          <div className="border border-[var(--wz-border)] p-3">
            <div className="overline mb-1 flex items-center gap-1"><Envelope size={11} /> Email (verbatim from filing)</div>
            <div className="text-[var(--wz-text-secondary)] space-y-0.5 break-all">
              {ir.email && (
                <a href={`mailto:${ir.email}`} className="hover:text-[var(--wz-text)] underline">
                  {ir.email}
                </a>
              )}
              {(gc.emails || []).filter((e) => e !== ir.email).slice(0, 3).map((e) => (
                <a key={e} href={`mailto:${e}`} className="block hover:text-[var(--wz-text)] underline">
                  {e}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Named executives */}
      {(contacts.executives || []).length > 0 ? (
        <div className="space-y-2" data-testid={`executives-${matchId}`}>
          {contacts.executives.map((ex, idx) => (
            <div
              key={idx}
              data-testid={`executive-${matchId}-${idx}`}
              className="border border-[var(--wz-border)] p-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-medium text-sm">{ex.name}</div>
                  <span className={`pill ${RELEVANCE_PILL[ex.relevance] || "pill"}`}>
                    {RELEVANCE_LABEL[ex.relevance] || "Other"}
                  </span>
                </div>
                <div className="text-xs text-[var(--wz-text-secondary)] mt-0.5">{ex.title}</div>
                {ex.rationale && (
                  <div className="text-xs text-[var(--wz-text-tertiary)] mt-1 italic">{ex.rationale}</div>
                )}
                {ex.source_excerpt && (
                  <details className="mt-1">
                    <summary className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] cursor-pointer hover:text-[var(--wz-text)]">
                      filing excerpt
                    </summary>
                    <div className="mt-1 text-[11px] text-[var(--wz-text-tertiary)] border-l-2 border-[var(--wz-border)] pl-2 italic">
                      "{ex.source_excerpt}"
                    </div>
                  </details>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {ex.linkedin_url ? (
                  <a
                    href={ex.linkedin_url}
                    target="_blank"
                    rel="noreferrer"
                    data-testid={`linkedin-${matchId}-${idx}`}
                    className="wz-btn-ghost wz-btn text-xs flex items-center gap-1"
                  >
                    <LinkedinLogo size={12} /> LinkedIn
                  </a>
                ) : (
                  <span className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)]">no LinkedIn match</span>
                )}
                <button
                  onClick={() => onAddContact(idx, ex.name)}
                  data-testid={`add-contact-lead-${matchId}-${idx}`}
                  className="wz-btn-ghost wz-btn text-xs flex items-center gap-1"
                  title="Add as Lead"
                >
                  <UserPlus size={12} /> Lead
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-[var(--wz-text-tertiary)] italic">
          No named executives extracted from this company's filings.
        </div>
      )}

      {/* Source filings */}
      {(contacts.used_filings || []).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3 text-[10px] font-mono-wz text-[var(--wz-text-tertiary)]">
          <span>sourced from:</span>
          {contacts.used_filings.map((f, i) => (
            <a
              key={i}
              href={f.url || "#"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline hover:text-[var(--wz-text)]"
              data-testid={`source-filing-${matchId}-${i}`}
            >
              {f.form} · {f.filed} <ArrowSquareOut size={9} />
            </a>
          ))}
          <span>
            · resolved {contacts.generated_at ? new Date(contacts.generated_at).toLocaleString() : ""}
          </span>
        </div>
      )}
    </div>
  );
}
