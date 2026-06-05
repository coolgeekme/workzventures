import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  FileMagnifyingGlass, ArrowLeft, ArrowSquareOut, DownloadSimple,
  CheckCircle, WarningOctagon, ChartLineUp, Briefcase, Buildings, ChartBar,
  Users, ShieldCheck, Money, ListChecks, Lightbulb, Files, Plus,
} from "@phosphor-icons/react";
import { api } from "../lib/api";

const REC_PILL = {
  "strong-buy": "pill-positive",
  buy: "pill-positive",
  hold: "pill-gold",
  pass: "pill-amber",
};

const SECTIONS = [
  { id: "exec",       label: "Executive summary",     icon: Lightbulb },
  { id: "company",    label: "Company overview",      icon: Buildings },
  { id: "market",     label: "Market analysis",       icon: ChartLineUp },
  { id: "competition",label: "Competitive landscape", icon: Briefcase },
  { id: "financial",  label: "Financial analysis",    icon: Money },
  { id: "team",       label: "Management team",       icon: Users },
  { id: "tech",       label: "Technology & IP",       icon: ChartBar },
  { id: "risks",      label: "Risk assessment",       icon: WarningOctagon },
  { id: "compliance", label: "Compliance & legal",    icon: ShieldCheck },
  { id: "valuation",  label: "Valuation",             icon: Money },
  { id: "takeaways",  label: "Buyer takeaways",       icon: CheckCircle },
  { id: "dd",         label: "Due diligence",         icon: ListChecks },
  { id: "sources",    label: "Sources",               icon: Files },
];

export default function DetailedReport() {
  const { rid } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const pollRef = useRef(null);

  const load = async () => {
    try {
      const r = await api.get(`/research/detailed/${rid}`);
      setReport(r.data);
      return r.data;
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to load");
    }
  };

  useEffect(() => { load(); }, [rid]); // eslint-disable-line

  // Poll while status is pending/analyzing
  useEffect(() => {
    if (!report) return;
    if (report.status === "completed" || report.status === "failed") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(load, 4000);
    return () => pollRef.current && clearInterval(pollRef.current);
  }, [report?.status]); // eslint-disable-line

  const downloadPdf = async () => {
    try {
      const r = await api.get(`/research/detailed/${rid}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `detailed-analysis-${(report.company_name || "company").toLowerCase().replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("PDF export failed");
    }
  };

  const data = report?.data || {};
  const sources = report?.sources || [];

  if (error) {
    return <div className="px-6 py-10 max-w-3xl mx-auto wz-card text-center text-sm text-[var(--wz-text-tertiary)]">{error}</div>;
  }
  if (!report) {
    return <div className="px-6 py-10 max-w-3xl mx-auto wz-card text-center text-sm text-[var(--wz-text-tertiary)]">Loading…</div>;
  }

  // ---- Pending / analyzing / failed states --------------------------------
  if (report.status !== "completed") {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8 max-w-3xl mx-auto" data-testid="detailed-status">
        <button onClick={() => navigate(-1)} className="text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-text)] flex items-center gap-1 mb-4">
          <ArrowLeft size={12} /> Back
        </button>
        <h1 className="font-display text-3xl tracking-tighter font-medium flex items-center gap-3">
          <FileMagnifyingGlass size={26} className="text-[var(--wz-amber)]" />
          {report.company_name}
        </h1>
        <div className="wz-card p-8 mt-6 text-center">
          {report.status === "failed" ? (
            <>
              <WarningOctagon size={32} className="text-[var(--wz-negative)] mx-auto mb-3" />
              <div className="font-medium">Analysis failed</div>
              <div className="text-xs text-[var(--wz-text-secondary)] mt-2 max-w-md mx-auto">
                {report.error || "Pipeline failed. Try re-running from the Research Hub."}
              </div>
            </>
          ) : (
            <>
              <div className="overline mb-2">{report.status === "analyzing" ? "AI ANALYSIS RUNNING" : "QUEUED"}</div>
              <div className="font-display text-xl tracking-tight mb-4">
                Generating detailed analysis for {report.company_name}…
              </div>
              <div className="h-1 bg-[var(--wz-border)] overflow-hidden max-w-md mx-auto">
                <div className="h-full bg-[var(--wz-amber)] animate-pulse" style={{ width: report.status === "analyzing" ? "75%" : "20%" }} />
              </div>
              <div className="text-xs text-[var(--wz-text-tertiary)] mt-4">
                Typically 60-180s · Perplexity grounding + 4 Brave searches + Claude 4.5 synthesis · Auto-refreshing every 4s
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ---- Completed ----------------------------------------------------------
  const es = data.executiveSummary || {};
  const rec = (es.recommendation || "hold").toLowerCase();

  return (
    <div data-testid="detailed-report" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1600px] mx-auto w-full">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <button onClick={() => navigate(-1)} className="text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-text)] flex items-center gap-1">
          <ArrowLeft size={12} /> Back
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setAttachOpen((v) => !v)}
            data-testid="attach-btn"
            className="wz-btn-ghost wz-btn text-xs flex items-center gap-2"
          >
            <Plus size={12} /> Attach to Vault
          </button>
          <button
            onClick={downloadPdf}
            data-testid="download-pdf-btn"
            className="wz-btn wz-btn-gold text-xs flex items-center gap-2"
          >
            <DownloadSimple size={12} /> Export PDF
          </button>
        </div>
      </div>

      <div className="overline mb-2" style={{ color: "var(--wz-amber)" }}>Workz Detailed Analysis</div>
      <div className="flex items-baseline gap-4 flex-wrap">
        <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">{report.company_name}</h1>
        <span className={`pill ${REC_PILL[rec] || "pill"} uppercase tracking-widest`}>
          {rec.replace("-", " ")}
        </span>
      </div>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-3xl">{es.headline}</p>

      <div className="flex flex-wrap gap-1.5 mt-3 text-[10px] font-mono-wz text-[var(--wz-text-tertiary)]">
        {report.industry && <span className="pill">{report.industry}</span>}
        {report.region && <span className="pill">{report.region}</span>}
        {report.company_url && <a href={report.company_url} target="_blank" rel="noreferrer" className="pill hover:border-[var(--wz-amber)] inline-flex items-center gap-1">{report.company_url.replace(/^https?:\/\//, "").slice(0, 32)}<ArrowSquareOut size={9} /></a>}
        <span className="pill">{report.source_count} sources</span>
        <span className="pill">generated {new Date(report.created_at).toLocaleString()}</span>
      </div>

      {attachOpen && <AttachPanel rid={rid} attaching={attaching} setAttaching={setAttaching} onClose={() => setAttachOpen(false)} />}

      {/* Section navigator */}
      <nav className="mt-6 flex flex-wrap gap-1.5 text-[10px] font-mono-wz" data-testid="section-nav">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="px-2 py-1 border border-[var(--wz-border)] hover:border-[var(--wz-amber)] hover:text-[var(--wz-text)] uppercase tracking-wider text-[var(--wz-text-tertiary)]">
            {s.label}
          </a>
        ))}
      </nav>

      <div className="mt-6 space-y-8">
        {/* Executive summary */}
        <SectionCard id="exec" icon={Lightbulb} title="Executive summary">
          <p className="text-sm leading-relaxed">{es.investmentThesis}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            <KV label="Valuation" value={es.keyMetrics?.valuation} />
            <KV label="Revenue" value={es.keyMetrics?.revenue} />
            <KV label="Growth" value={es.keyMetrics?.growth} />
            <KV label="Employees" value={es.keyMetrics?.employees} />
          </div>
        </SectionCard>

        {/* Company overview */}
        <SectionCard id="company" icon={Buildings} title="Company overview">
          <KVList rows={[
            ["Description", data.companyOverview?.description],
            ["Business model", data.companyOverview?.businessModel],
            ["Value proposition", data.companyOverview?.valueProposition],
            ["Target market", data.companyOverview?.targetMarket],
            ["Revenue model", data.companyOverview?.revenueModel],
            ["Geographic presence", data.companyOverview?.geographicPresence],
            ["Founded", data.companyOverview?.foundedYear],
            ["Headquarters", data.companyOverview?.headquarters],
            ["Founders", Array.isArray(data.companyOverview?.founders) ? data.companyOverview.founders.join(", ") : data.companyOverview?.founders],
            ["Customer base", data.companyOverview?.customerBase],
            ["Product-market fit", data.companyOverview?.productMarketFit],
          ]} />
        </SectionCard>

        <SectionCard id="market" icon={ChartLineUp} title="Market analysis">
          <KVList rows={[
            ["TAM", data.marketAnalysis?.tam],
            ["SAM", data.marketAnalysis?.sam],
            ["Market size", data.marketAnalysis?.marketSize],
            ["Growth rate", data.marketAnalysis?.marketGrowthRate],
            ["Regulatory environment", data.marketAnalysis?.regulatoryEnvironment],
          ]} />
        </SectionCard>

        <SectionCard id="competition" icon={Briefcase} title="Competitive landscape">
          <KVList rows={[
            ["Market positioning", data.competitiveLandscape?.marketPositioning],
            ["Competitive moat", data.competitiveLandscape?.competitiveMoat],
            ["Market share", data.competitiveLandscape?.marketShare],
            ["Switching costs", data.competitiveLandscape?.switchingCosts],
          ]} />
          <Bullets label="Direct competitors" items={data.competitiveLandscape?.directCompetitors} />
          <Bullets label="Indirect competitors" items={data.competitiveLandscape?.indirectCompetitors} />
          <Bullets label="Competitive advantages" items={data.competitiveLandscape?.competitiveAdvantages} accent="positive" />
          <Bullets label="Threats" items={data.competitiveLandscape?.threats} accent="negative" />
        </SectionCard>

        <SectionCard id="financial" icon={Money} title="Financial analysis">
          <KVList rows={[
            ["Revenue growth", data.financialAnalysis?.revenueGrowth],
            ["Profitability", data.financialAnalysis?.profitabilityMetrics],
            ["Burn rate", data.financialAnalysis?.burnRate],
            ["Funding history", data.financialAnalysis?.fundingHistory],
            ["Projections", data.financialAnalysis?.projections],
          ]} />
        </SectionCard>

        <SectionCard id="team" icon={Users} title="Management team">
          <KVList rows={[
            ["Founder background", data.managementTeam?.founderBackground],
            ["Executive team", data.managementTeam?.executiveTeam],
            ["Board composition", data.managementTeam?.boardComposition],
            ["Team gaps", data.managementTeam?.teamGaps],
          ]} />
        </SectionCard>

        <SectionCard id="tech" icon={ChartBar} title="Technology & IP">
          <KVList rows={[
            ["Technology stack", data.technologyIP?.technologyStack],
            ["IP portfolio", data.technologyIP?.ipPortfolio],
            ["Patents", data.technologyIP?.patents],
            ["R&D capabilities", data.technologyIP?.rdCapabilities],
          ]} />
        </SectionCard>

        <SectionCard id="risks" icon={WarningOctagon} title="Risk assessment" accent="negative">
          <Bullets label="Market risks" items={data.riskAssessment?.marketRisks} accent="negative" />
          <Bullets label="Operational risks" items={data.riskAssessment?.operationalRisks} accent="negative" />
          <Bullets label="Financial risks" items={data.riskAssessment?.financialRisks} accent="negative" />
          <Bullets label="Technology risks" items={data.riskAssessment?.technologyRisks} accent="negative" />
          <Bullets label="Regulatory risks" items={data.riskAssessment?.regulatoryRisks} accent="negative" />
        </SectionCard>

        <SectionCard id="compliance" icon={ShieldCheck} title="Compliance & legal">
          <KVList rows={[
            ["Compliance status", data.complianceAndLegal?.complianceStatus],
            ["Regulatory violations", data.complianceAndLegal?.regulatoryViolations],
            ["Legal proceedings", data.complianceAndLegal?.legalProceedings],
            ["International compliance", data.complianceAndLegal?.internationalCompliance],
            ["Executive backgrounds", data.complianceAndLegal?.executiveBackgrounds],
          ]} />
        </SectionCard>

        <SectionCard id="valuation" icon={Money} title="Valuation">
          <KVList rows={[
            ["Current valuation", data.valuation?.currentValuation],
            ["Comparable analysis", data.valuation?.comparableAnalysis],
            ["Fair-value range", data.valuation?.fairValueRange],
            ["Methodology", data.valuation?.methodology],
          ]} />
        </SectionCard>

        <SectionCard id="takeaways" icon={CheckCircle} title="Buyer takeaways">
          <Bullets label="Key strengths" items={data.keyStrengths} accent="positive" />
          <Bullets label="Key risks" items={data.keyRisks} accent="negative" />
          <Bullets label="Strategic recommendations" items={data.strategicRecommendations} accent="gold" />
        </SectionCard>

        <SectionCard id="dd" icon={ListChecks} title="Due diligence questions">
          <Bullets label="Financial" items={data.dueDiligenceQuestions?.financial} />
          <Bullets label="Market" items={data.dueDiligenceQuestions?.market} />
          <Bullets label="Technology" items={data.dueDiligenceQuestions?.technology} />
          <Bullets label="Team" items={data.dueDiligenceQuestions?.team} />
          <Bullets label="Legal" items={data.dueDiligenceQuestions?.legal} />
        </SectionCard>

        <SectionCard id="sources" icon={Files} title={`Sources (${sources.length})`}>
          <ol className="space-y-2 text-xs" data-testid="sources-list">
            {sources.map((s) => (
              <li key={s.index} className="grid grid-cols-[30px_1fr_auto] gap-3 items-start">
                <span className="font-mono-wz text-[var(--wz-gold)]">[{s.index}]</span>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-[var(--wz-text-secondary)] hover:text-[var(--wz-text)] underline truncate" data-testid={`source-${s.index}`}>
                  {s.title || s.url}
                </a>
                <span className="text-[10px] font-mono-wz uppercase tracking-widest text-[var(--wz-text-tertiary)]">{s.provider}</span>
              </li>
            ))}
          </ol>
        </SectionCard>
      </div>
    </div>
  );
}

/* ============================================================================
 * AttachPanel — promotes the report PDF into a Vault (buyer) or Listing data
 * room (seller/admin)
 * ========================================================================== */
function AttachPanel({ rid, attaching, setAttaching, onClose }) {
  const [target, setTarget] = useState("vault");
  const [vaults, setVaults] = useState([]);
  const [listings, setListings] = useState([]);
  const [chosen, setChosen] = useState("");

  useEffect(() => {
    if (target === "vault") {
      api.get("/deal-rooms").then((r) => setVaults(r.data || [])).catch(() => {});
    } else {
      api.get("/listings").then((r) => setListings(r.data || [])).catch(() => {});
    }
    setChosen("");
  }, [target]);

  const submit = async () => {
    if (!chosen) return toast.error("Pick a target");
    setAttaching(true);
    try {
      await api.post(`/research/detailed/${rid}/attach`, target === "vault"
        ? { room_id: chosen } : { listing_id: chosen });
      toast.success("Report attached as PDF");
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Attach failed");
    } finally {
      setAttaching(false);
    }
  };

  return (
    <div className="wz-card p-4 mt-4 space-y-3" data-testid="attach-panel">
      <div className="overline">Attach this report as a PDF to:</div>
      <div className="flex gap-2">
        <button onClick={() => setTarget("vault")} data-testid="target-vault" className={`text-xs px-3 py-1 border ${target === "vault" ? "border-[var(--wz-amber)] bg-[var(--wz-surface-hover)]" : "border-[var(--wz-border)]"}`}>A Vault (buyer)</button>
        <button onClick={() => setTarget("listing")} data-testid="target-listing" className={`text-xs px-3 py-1 border ${target === "listing" ? "border-[var(--wz-amber)] bg-[var(--wz-surface-hover)]" : "border-[var(--wz-border)]"}`}>A Listing data room (seller)</button>
      </div>
      <select value={chosen} onChange={(e) => setChosen(e.target.value)} className="wz-input text-sm" data-testid="attach-select">
        <option value="">Choose…</option>
        {(target === "vault" ? vaults : listings).map((x) => (
          <option key={x.id} value={x.id}>
            {target === "vault" ? `${x.listing_name} · ${x.buyer_name}` : x.company_name}
          </option>
        ))}
      </select>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="wz-btn-ghost wz-btn text-xs">Cancel</button>
        <button onClick={submit} disabled={attaching || !chosen} data-testid="attach-submit" className="wz-btn wz-btn-gold text-xs">
          {attaching ? "Attaching…" : "Attach PDF"}
        </button>
      </div>
    </div>
  );
}

/* --- Reusable bits ------------------------------------------------------- */
function SectionCard({ id, icon: Icon, title, accent, children }) {
  return (
    <section id={id} className="wz-card p-5 scroll-mt-20" data-testid={`section-${id}`}>
      <div className="overline flex items-center gap-2 mb-3" style={accent === "negative" ? { color: "var(--wz-negative)" } : { color: "var(--wz-amber)" }}>
        <Icon size={13} />{title}
      </div>
      {children}
    </section>
  );
}

function KV({ label, value }) {
  return (
    <div className="border border-[var(--wz-border)] p-2">
      <div className="overline mb-1">{label}</div>
      <div className="font-mono-wz text-sm break-words">{value || "—"}</div>
    </div>
  );
}

function KVList({ rows }) {
  return (
    <div className="divide-y divide-[var(--wz-border)] text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 py-2">
          <div className="overline">{k}</div>
          <div className="text-[var(--wz-text-secondary)] leading-relaxed break-words">{v || <span className="text-[var(--wz-text-tertiary)] italic">—</span>}</div>
        </div>
      ))}
    </div>
  );
}

function Bullets({ label, items, accent }) {
  const list = (items || []).filter(Boolean);
  if (list.length === 0) return null;
  const color = accent === "positive" ? "var(--wz-positive)" : accent === "negative" ? "var(--wz-negative)" : accent === "gold" ? "var(--wz-amber)" : "var(--wz-text-tertiary)";
  return (
    <div className="mt-3">
      <div className="overline mb-2">{label}</div>
      <ul className="space-y-1.5 text-sm">
        {list.map((it, i) => (
          <li key={i} className="flex gap-2 text-[var(--wz-text-secondary)] leading-relaxed">
            <span style={{ color }}>▸</span><span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
