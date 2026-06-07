import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { MagnifyingGlass, Trash, FileMagnifyingGlass } from "@phosphor-icons/react";

export default function ResearchHub() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ company_name: "", company_url: "", sector: "", region: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [queueingDetailed, setQueueingDetailed] = useState(false);
  const pollRef = useRef(null);

  const loadHistory = () => api.get("/research/history").then((r) => setHistory(r.data));

  useEffect(() => { loadHistory(); }, []);
  useEffect(() => () => pollRef.current && clearInterval(pollRef.current), []);

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.company_name) return;
    setLoading(true);
    setCurrent(null);
    pollRef.current && clearInterval(pollRef.current);
    try {
      const r = await api.post("/research/company", form);
      setCurrent(r.data);
      // Async pipeline: poll until completed | failed
      if (r.data.status === "completed") {
        toast.success(`Research brief ready: ${r.data.company_name}`);
        setLoading(false);
        loadHistory();
        return;
      }
      // Begin polling
      const rid = r.data.id;
      pollRef.current = setInterval(async () => {
        try {
          const pr = await api.get(`/research/detail/${rid}`);
          setCurrent(pr.data);
          if (pr.data.status === "completed") {
            clearInterval(pollRef.current);
            setLoading(false);
            toast.success(`Research brief ready: ${pr.data.company_name}`);
            loadHistory();
          } else if (pr.data.status === "failed") {
            clearInterval(pollRef.current);
            setLoading(false);
            toast.error(pr.data.error || "Research failed");
          }
        } catch {
          // transient network error — keep polling
        }
      }, 4000);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Research failed to queue");
      setLoading(false);
    }
  };

  const D = current?.data || {};

  const runDetailed = async () => {
    setQueueingDetailed(true);
    try {
      const r = await api.post("/research/detailed", {
        company_name: current.company_name,
        company_url: current.company_url || D.website || form.company_url || null,
        industry: current.sector || D.sector || null,
        region: current.region || null,
        buyer_notes: form.notes || null,
        research_id: current.id,
      });
      toast.success("Detailed analysis queued — typically 60-180s");
      navigate(`/app/research/detailed/${r.data.id}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to queue detailed analysis");
    } finally {
      setQueueingDetailed(false);
    }
  };

  return (
    <div data-testid="research-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="overline mb-3">Buyer Research Hub</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        Synthesize any company on demand.
      </h1>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-3 max-w-2xl">
        Our AI researcher aggregates public web + market signals into an institutional research brief — profile, leadership, growth drivers, risks, and a Workz-style investor take.
      </p>

      <form onSubmit={submit} data-mcp-action="research.company.summarize" className="wz-card p-6 mt-8 grid grid-cols-1 md:grid-cols-4 gap-4" data-testid="research-form">
        <div className="md:col-span-2">
          <div className="overline mb-2">Company name *</div>
          <input data-testid="research-company" className="wz-input" required value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="Anthropic, Stripe, Klarna…" />
        </div>
        <div className="md:col-span-2">
          <div className="overline mb-2">Company website</div>
          <input data-testid="research-website" type="url" inputMode="url" className="wz-input" value={form.company_url} onChange={(e) => setForm({ ...form, company_url: e.target.value })} placeholder="https://stripe.com" />
        </div>
        <div>
          <div className="overline mb-2">Sector hint</div>
          <input data-testid="research-sector" className="wz-input" value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} placeholder="SaaS, HealthTech…" />
        </div>
        <div>
          <div className="overline mb-2">Region</div>
          <input data-testid="research-region" className="wz-input" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="EMEA, NA, APAC" />
        </div>
        <div className="md:col-span-2">
          <div className="overline mb-2">Buyer notes (optional)</div>
          <input data-testid="research-notes" className="wz-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g., looking for $200M–$500M EBITDA targets" />
        </div>
        <div className="flex items-end md:col-span-4">
          <button type="submit" disabled={loading} data-testid="research-submit" className="wz-btn wz-btn-gold w-full flex items-center justify-center gap-2">
            {loading ? "Synthesizing…" : (<><MagnifyingGlass size={16} /> Generate brief</>)}
          </button>
        </div>
      </form>

      {loading && (
        <div className="mt-6 wz-card p-6 font-mono-wz text-sm text-[var(--wz-text-secondary)]" data-testid="research-loading">
          <div className="flex items-center gap-3"><div className="dot-blink" /> {current?.status === "analyzing" ? "AI analyzing — Perplexity + Brave + Claude in flight…" : "Queuing your research…"}</div>
          <div className="mt-3 h-1 bg-[var(--wz-border)] overflow-hidden">
            <div className="h-full bg-[var(--wz-gold)] animate-pulse" style={{ width: current?.status === "analyzing" ? "75%" : "20%" }} />
          </div>
          <div className="mt-3 text-xs text-[var(--wz-text-tertiary)]">
            Typically 30-90s · we&apos;ll auto-refresh until the brief is ready, no need to wait on this tab.
          </div>
        </div>
      )}

      {current && current.status === "completed" && D && (
        <div className="mt-8 wz-card" data-testid="research-result">
          <div className="border-b border-[var(--wz-border)] px-6 py-5 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-display text-2xl tracking-tight">{D.company_name || current.company_name}</div>
              <div className="text-sm text-[var(--wz-text-secondary)] mt-1">{D.one_liner}</div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {current.live_research_used && (
                <span className="pill pill-positive" data-testid="live-research-pill">live web research</span>
              )}
              <span className="pill pill-gold">{D.sector || current.sector || "—"}</span>
              <button
                onClick={runDetailed}
                disabled={queueingDetailed}
                data-testid="run-detailed-btn"
                title="Generate the full 14-section institutional analysis with sources, risks, valuation, due-diligence questions"
                className="wz-btn wz-btn-gold text-xs flex items-center gap-2"
              >
                <FileMagnifyingGlass size={13} />
                {queueingDetailed ? "Queuing…" : "Run Detailed Analysis"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--wz-border)]">
            {[
              ["HQ", D.headquarters],
              ["Founded", D.founded],
              ["Employees", D.employees_range],
              ["Revenue", D.estimated_revenue],
            ].map(([k, v]) => (
              <div key={k} className="bg-[var(--wz-surface)] p-4">
                <div className="overline mb-1">{k}</div>
                <div className="font-mono-wz text-sm">{v || "—"}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[var(--wz-border)]">
            <Section title="Business model" body={D.business_model} />
            <Section title="Investor take" body={D.investor_take} />
            <ListBlock title="Market signals" items={D.market_signals} />
            <ListBlock title="Growth drivers" items={D.growth_drivers} />
            <ListBlock title="Risks" items={D.risks} accent="neg" />
            <ListBlock title="Competitive landscape" items={D.competitive_landscape} />
          </div>

          {Array.isArray(D.leadership) && D.leadership.length > 0 && (
            <div className="px-6 py-5 border-t border-[var(--wz-border)]">
              <div className="overline mb-3">Leadership insights</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {D.leadership.map((l, i) => (
                  <div key={i} className="border border-[var(--wz-border)] p-4">
                    <div className="font-display tracking-tight">{l.name}</div>
                    <div className="overline mt-1">{l.title}</div>
                    <div className="text-xs text-[var(--wz-text-secondary)] mt-3 leading-relaxed">{l.background}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {D.suggested_buyer_profile && (
            <div className="px-6 py-5 border-t border-[var(--wz-border)]">
              <div className="overline mb-2">Suggested buyer profile</div>
              <div className="text-sm">{D.suggested_buyer_profile}</div>
            </div>
          )}

          {Array.isArray(D.next_actions) && (
            <div className="px-6 py-5 border-t border-[var(--wz-border)]">
              <div className="overline mb-2">Next actions</div>
              <ol className="space-y-2 text-sm">
                {D.next_actions.map((a, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="font-mono-wz text-[var(--wz-gold)]">{String(i + 1).padStart(2, "0")}</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {Array.isArray(current.sources) && current.sources.length > 0 && (
            <div className="px-6 py-5 border-t border-[var(--wz-border)]" data-testid="research-sources">
              <div className="flex items-center justify-between mb-3">
                <div className="overline">Sources · live web</div>
                <span className="font-mono-wz text-[10px] text-[var(--wz-text-tertiary)]">
                  {current.sources.length} cited
                </span>
              </div>
              <ol className="space-y-2">
                {current.sources.map((s) => (
                  <li key={s.index} className="grid grid-cols-[24px_1fr_80px] gap-3 items-start text-xs">
                    <span className="font-mono-wz text-[var(--wz-gold)]">[{s.index}]</span>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--wz-text-secondary)] hover:text-white underline-offset-4 hover:underline truncate"
                      data-testid={`source-${s.index}`}
                    >
                      {s.title || s.url}
                    </a>
                    <span className="font-mono-wz text-[10px] uppercase tracking-widest text-[var(--wz-text-tertiary)] text-right">
                      {s.provider}{s.age ? ` · ${s.age}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      <div className="mt-12">
        <div className="overline mb-4">Research history</div>
        <div className="wz-grid grid-cols-1 md:grid-cols-3" data-testid="research-history">
          {history.map((h) => (
            <div key={h.id} className="p-5 group relative" data-testid={`research-item-${h.id}`}>
              <button
                onClick={() => setCurrent(h)}
                className="w-full text-left"
                data-testid={`research-open-${h.id}`}
              >
                <div className="font-display tracking-tight pr-8">{h.company_name}</div>
                <div className="overline mt-1">{new Date(h.created_at).toLocaleString()}</div>
                <div className="text-xs text-[var(--wz-text-secondary)] mt-2 line-clamp-2">{h.data?.one_liner}</div>
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!window.confirm(`Delete research brief for ${h.company_name}?`)) return;
                  try {
                    await api.delete(`/research/${h.id}`);
                    toast.success("Research brief deleted");
                    if (current?.id === h.id) setCurrent(null);
                    loadHistory();
                  } catch (err) {
                    toast.error(err?.response?.data?.detail || "Delete failed");
                  }
                }}
                data-testid={`research-delete-${h.id}`}
                title="Delete this brief"
                className="absolute top-3 right-3 p-1 text-[var(--wz-text-tertiary)] hover:text-[var(--wz-negative)] transition-colors"
              >
                <Trash size={13} />
              </button>
            </div>
          ))}
          {history.length === 0 && (
            <div className="p-8 text-sm text-[var(--wz-text-tertiary)] col-span-3">No briefs yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, body }) {
  return (
    <div className="bg-[var(--wz-surface)] p-5">
      <div className="overline mb-2">{title}</div>
      <div className="text-sm leading-relaxed text-[var(--wz-text-secondary)]">{body || "—"}</div>
    </div>
  );
}

function ListBlock({ title, items, accent }) {
  return (
    <div className="bg-[var(--wz-surface)] p-5">
      <div className="overline mb-2">{title}</div>
      <ul className="space-y-1.5 text-sm">
        {(items || []).map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className={`mt-2 w-1 h-1 ${accent === "neg" ? "bg-[var(--wz-negative)]" : "bg-[var(--wz-gold)]"}`} />
            <span className="text-[var(--wz-text-secondary)]">{it}</span>
          </li>
        ))}
        {(!items || items.length === 0) && <li className="text-[var(--wz-text-tertiary)] text-xs">—</li>}
      </ul>
    </div>
  );
}
