import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { EnvelopeSimple, CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react";

const COVER = "https://static.prod-images.emergentagent.com/jobs/99d61e05-18d6-4593-8525-63fadbb097b3/images/5cd58ebd0d3fa73fe174fd8942a03605c23c536b3bff18e72a17d700bd86c4b4.png";
const INTERESTS = ["SaaS", "HealthTech", "Industrial", "FinServ", "ClimateTech", "Consumer", "EMEA", "NA", "APAC"];

export default function Newsletter() {
  const { user, setUser } = useAuth();
  const [prefs, setPrefs] = useState({ opt_in: false, interests: [], cadence: "weekly" });
  const [list, setList] = useState([]);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);

  const load = () => Promise.all([
    api.get("/newsletter/preferences").then((r) => setPrefs(r.data)),
    api.get("/newsletter").then((r) => setList(r.data)),
  ]);

  useEffect(() => { load(); }, []);

  const savePrefs = async (next) => {
    setPrefs(next);
    try {
      await api.post("/newsletter/preferences", next);
      // refresh /me so user.newsletter_opt_in is current
      const me = (await api.get("/auth/me")).data;
      localStorage.setItem("wz_user", JSON.stringify(me));
      setUser(me);
      toast.success("Preferences saved");
    } catch (err) {
      toast.error("Save failed");
    }
  };

  const toggleInterest = (i) => {
    const next = prefs.interests.includes(i)
      ? prefs.interests.filter((x) => x !== i)
      : [...prefs.interests, i];
    savePrefs({ ...prefs, interests: next });
  };

  const draft = async () => {
    setLoading(true);
    try {
      await api.post("/newsletter/draft", { topic: topic || undefined });
      toast.success("AI newsletter drafted");
      setTopic("");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Draft failed");
    } finally {
      setLoading(false);
    }
  };

  const approve = async (id) => {
    await api.post(`/newsletter/${id}/approve`);
    toast.success("Approved");
    load();
  };

  const dispatch = async (id) => {
    const r = await api.post(`/newsletter/${id}/dispatch`);
    toast.success(`Dispatched to ${r.data.recipients} buyers (MOCKED)`);
    load();
  };

  return (
    <div data-testid="newsletter-page" className="px-8 py-8">
      <div className="overline mb-3">Newsletter center</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        Curated deal flow, in every inbox.
      </h1>

      {/* Preferences */}
      <div className="wz-card p-6 mt-8" data-testid="prefs-panel">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="overline mb-2">Subscription</div>
            <div className="font-display text-xl tracking-tight">AI-personalized newsletter</div>
            <p className="text-sm text-[var(--wz-text-secondary)] mt-1 max-w-lg">
              Opt in to receive deal spotlights, market analyses, and portfolio updates curated by Claude Sonnet 4.5 for your interest profile.
            </p>
          </div>
          <label className="flex items-center gap-3 cursor-pointer" data-testid="opt-toggle">
            <span className="overline">{prefs.opt_in ? "Opted in" : "Opted out"}</span>
            <button
              type="button"
              onClick={() => savePrefs({ ...prefs, opt_in: !prefs.opt_in })}
              className={`w-12 h-6 border ${prefs.opt_in ? "bg-[var(--wz-gold)] border-[var(--wz-gold)]" : "bg-transparent border-[var(--wz-border)]"} relative transition-colors`}
            >
              <span className={`absolute top-0.5 ${prefs.opt_in ? "right-0.5" : "left-0.5"} w-4 h-4 ${prefs.opt_in ? "bg-black" : "bg-white"} transition-all`} />
            </button>
          </label>
        </div>

        <div className="mt-6">
          <div className="overline mb-3">Interests (tap to toggle)</div>
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleInterest(i)}
                data-testid={`interest-${i}`}
                className={`text-xs font-mono-wz uppercase tracking-widest px-3 py-1 border transition-colors ${
                  prefs.interests.includes(i)
                    ? "bg-[var(--wz-gold)] text-black border-[var(--wz-gold)]"
                    : "border-[var(--wz-border)] hover:border-[var(--wz-text-tertiary)]"
                }`}
              >
                {i}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <span className="overline">Cadence</span>
          {["weekly", "biweekly", "monthly"].map((c) => (
            <button
              key={c}
              onClick={() => savePrefs({ ...prefs, cadence: c })}
              data-testid={`cadence-${c}`}
              className={`text-xs font-mono-wz uppercase tracking-widest px-3 py-1 border transition-colors ${
                prefs.cadence === c ? "border-[var(--wz-gold)] text-[var(--wz-gold)]" : "border-[var(--wz-border)] hover:border-[var(--wz-text-tertiary)]"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Draft */}
      <div className="wz-card p-6 mt-6" data-mcp-action="newsletter.draft" data-testid="draft-panel">
        <div className="flex items-center gap-3 mb-3">
          <EnvelopeSimple size={18} className="text-[var(--wz-gold)]" />
          <div className="font-display text-lg tracking-tight">AI-draft a new issue</div>
        </div>
        <div className="grid md:grid-cols-[1fr_auto] gap-3">
          <input
            data-testid="draft-topic"
            placeholder="Topic focus (optional) — e.g., 'European MedTech consolidation'"
            className="wz-input" value={topic} onChange={(e) => setTopic(e.target.value)}
          />
          <button onClick={draft} disabled={loading} data-testid="draft-btn" className="wz-btn wz-btn-gold flex items-center gap-2">
            {loading ? "Drafting…" : "Draft with Claude"}
          </button>
        </div>
      </div>

      {/* Newsletter list */}
      <div className="mt-10 space-y-6" data-testid="newsletter-list">
        {list.map((n) => {
          const D = n.data || {};
          return (
            <article key={n.id} className="wz-card overflow-hidden">
              <div className="grid md:grid-cols-[200px_1fr]">
                <div className="relative h-full min-h-[180px]">
                  <img src={COVER} alt="cover" className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--wz-bg)] to-transparent" />
                </div>
                <div className="p-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="overline">{D.issue_tagline || "Workz weekly"}</div>
                    <span className={`pill ${
                      n.status === "dispatched" ? "pill-positive" :
                      n.status === "approved" ? "pill-gold" : "pill-amber"
                    }`}>{n.status}</span>
                  </div>
                  <h2 className="font-display text-2xl tracking-tight">{D.title || "Untitled issue"}</h2>

                  <div className="mt-5 grid md:grid-cols-2 gap-5">
                    <div>
                      <div className="overline mb-2">Deal spotlights</div>
                      <ul className="space-y-2 text-sm">
                        {(D.deal_spotlights || []).slice(0, 3).map((d, i) => (
                          <li key={i}>
                            <div className="text-white">{d.headline}</div>
                            <div className="text-xs text-[var(--wz-text-secondary)] mt-0.5">{d.summary}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="overline mb-2">Market analysis</div>
                      <p className="text-sm text-[var(--wz-text-secondary)] leading-relaxed">{D.market_analysis}</p>
                    </div>
                  </div>

                  {D.editor_note && (
                    <div className="mt-5 pt-4 border-t border-[var(--wz-border)] text-xs italic text-[var(--wz-text-secondary)]">
                      — {D.editor_note}
                    </div>
                  )}

                  <div className="mt-5 flex gap-3 items-center" data-mcp-action="newsletter.dispatch">
                    {n.status === "draft" && (
                      <button onClick={() => approve(n.id)} data-testid={`approve-${n.id}`} className="wz-btn-ghost wz-btn flex items-center gap-2 text-sm">
                        <CheckCircle size={14} /> Approve
                      </button>
                    )}
                    {n.status !== "dispatched" && (
                      <button onClick={() => dispatch(n.id)} data-testid={`dispatch-${n.id}`} className="wz-btn wz-btn-gold flex items-center gap-2 text-sm">
                        <PaperPlaneTilt size={14} /> Dispatch (mock)
                      </button>
                    )}
                    {n.status === "dispatched" && (
                      <div className="text-xs font-mono-wz text-[var(--wz-text-secondary)]">
                        delivered → {n.recipients} buyers · {new Date(n.dispatched_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
        {list.length === 0 && (
          <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)]">
            No newsletters yet. Draft your first AI issue above.
          </div>
        )}
      </div>
    </div>
  );
}
