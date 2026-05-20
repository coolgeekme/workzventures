import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { EnvelopeSimple, CheckCircle, PaperPlaneTilt, Sparkle, Megaphone } from "@phosphor-icons/react";

const COVER = "https://customer-assets.emergentagent.com/job_buyer-intel-lab/artifacts/mtl2u4cl_eb9c42c75e492db9ec952105c8ad0f0d.png";
const INTERESTS = ["SaaS", "HealthTech", "Industrial", "FinServ", "ClimateTech", "Consumer", "EMEA", "NA", "APAC"];

export default function Newsletter() {
  const { user } = useAuth();
  if (user?.role === "seller") return <SellerBroadcast />;
  if (user?.role === "admin") return <SellerBroadcast />;
  return <BuyerDigest />;
}

/* ============================================================================
 * BUYER VIEW — personal digest (self-delivery, Workz Ventures-branded)
 * ========================================================================== */
function BuyerDigest() {
  const { user, setUser } = useAuth();
  const [prefs, setPrefs] = useState({ opt_in: false, interests: [], cadence: "weekly" });
  const [list, setList] = useState([]);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);

  const load = () => Promise.all([
    api.get("/newsletter/preferences").then((r) => setPrefs(r.data)),
    api.get("/newsletter").then((r) => setList(r.data.filter((n) => (n.kind || "personal") === "personal"))),
  ]);

  useEffect(() => { load(); }, []);

  const savePrefs = async (next) => {
    setPrefs(next);
    try {
      await api.post("/newsletter/preferences", next);
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

  const generateDigest = async () => {
    setLoading(true);
    try {
      await api.post("/newsletter/personal", { topic: topic || undefined });
      toast.success(`Digest delivered to ${user?.email}`);
      setTopic("");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="newsletter-page" className="px-8 py-8">
      <div className="overline mb-3">Your personal digest</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        Workz Ventures, curated for you.
      </h1>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
        Tell us what you care about. Tap the button — our AI compiles a private digest of deal spotlights, market analyses, and portfolio updates against your interest profile and delivers it to <span className="font-mono-wz text-[var(--wz-gold)]">{user?.email}</span>. No one else sees it.
      </p>

      {/* Preferences */}
      <div className="wz-card p-6 mt-8" data-testid="prefs-panel">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="overline mb-2">Subscription</div>
            <div className="font-display text-xl tracking-tight">My personal newsletter</div>
            <p className="text-sm text-[var(--wz-text-secondary)] mt-1 max-w-lg">
              Opt in to receive a Workz-branded digest tailored to <em>your</em> interest profile. Cadence and interests are saved to your account and used the next time you generate a digest.
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

        <div className="mt-6 flex items-center gap-3 flex-wrap">
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

      {/* Generate */}
      <div className="wz-card p-6 mt-6" data-mcp-action="newsletter.draft" data-testid="draft-panel">
        <div className="flex items-center gap-3 mb-3">
          <Sparkle size={18} className="text-[var(--wz-gold)]" />
          <div className="font-display text-lg tracking-tight">Generate today's digest</div>
        </div>
        <div className="grid md:grid-cols-[1fr_auto] gap-3">
          <input
            data-testid="draft-topic"
            placeholder="Optional focus — e.g., 'European MedTech consolidation' or leave blank for a full update"
            className="wz-input" value={topic} onChange={(e) => setTopic(e.target.value)}
          />
          <button onClick={generateDigest} disabled={loading || !prefs.opt_in} data-testid="draft-btn" className="wz-btn wz-btn-gold flex items-center gap-2">
            {loading ? "Compiling…" : (<><PaperPlaneTilt size={14} /> Send to my inbox</>)}
          </button>
        </div>
        {!prefs.opt_in && (
          <div className="mt-3 text-xs text-[var(--wz-amber)]">Opt in above to enable delivery.</div>
        )}
      </div>

      {/* Digest history */}
      <div className="mt-10">
        <div className="overline mb-4">My digests</div>
        <div className="space-y-6" data-testid="newsletter-list">
          {list.map((n) => {
            const D = n.data || {};
            return (
              <article key={n.id} className="wz-card overflow-hidden">
                <div className="grid md:grid-cols-[200px_1fr]">
                  <div className="relative h-full min-h-[200px]">
                    <img src={COVER} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[var(--wz-bg)] to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3">
                      <div className="overline text-white">Workz Ventures</div>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <div className="overline">{D.issue_tagline || "Personal digest"}</div>
                      <span className="pill pill-positive">delivered</span>
                    </div>
                    <h2 className="font-display text-2xl tracking-tight">{D.title || "Your digest"}</h2>

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

                    <div className="mt-5 text-xs font-mono-wz text-[var(--wz-text-tertiary)]">
                      delivered to {n.recipient_email || user?.email} · {new Date(n.dispatched_at || n.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
          {list.length === 0 && (
            <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)]">
              You haven't generated any digests yet — tap "Send to my inbox" above.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * SELLER VIEW — broadcast newsletter to opted-in buyers
 * ========================================================================== */
function SellerBroadcast() {
  const [list, setList] = useState([]);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [optedInCount, setOptedInCount] = useState(null);

  const load = () => Promise.all([
    api.get("/newsletter").then((r) => setList(r.data.filter((n) => n.kind !== "personal"))),
  ]);

  useEffect(() => { load(); }, []);

  const draft = async () => {
    setLoading(true);
    try {
      await api.post("/newsletter/draft", { topic: topic || undefined });
      toast.success("Broadcast drafted by AI");
      setTopic("");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
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
    setOptedInCount(r.data.recipients);
    toast.success(`Broadcast to ${r.data.recipients} opted-in buyers (MOCKED)`);
    load();
  };

  return (
    <div data-testid="newsletter-page" className="px-8 py-8">
      <div className="overline mb-3" style={{ color: "var(--wz-amber)" }}>Broadcast newsletter</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        Reach the entire buyer base.
      </h1>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
        Draft a broadcast about your portfolio. AI handles the prose; you approve and ship. Delivers to every buyer who has opted in via Workz, branded with your sender name and Workz Ventures.
      </p>

      {/* Draft */}
      <div className="wz-card p-6 mt-8" data-testid="draft-panel">
        <div className="flex items-center gap-3 mb-3">
          <Megaphone size={18} className="text-[var(--wz-amber)]" />
          <div className="font-display text-lg tracking-tight">Draft a broadcast</div>
        </div>
        <div className="grid md:grid-cols-[1fr_auto] gap-3">
          <input
            data-testid="draft-topic"
            placeholder="Topic / angle — e.g., 'Helios MedTech FDA milestone & open round'"
            className="wz-input" value={topic} onChange={(e) => setTopic(e.target.value)}
          />
          <button onClick={draft} disabled={loading} data-testid="draft-btn" className="wz-btn wz-btn-gold flex items-center gap-2">
            {loading ? "Drafting…" : "Draft broadcast"}
          </button>
        </div>
        {optedInCount !== null && (
          <div className="mt-4 text-xs font-mono-wz text-[var(--wz-text-secondary)]">
            last dispatch reached <span className="text-[var(--wz-positive)]">{optedInCount}</span> opted-in buyers
          </div>
        )}
      </div>

      {/* Broadcast list */}
      <div className="mt-10 space-y-6" data-testid="newsletter-list">
        {list.map((n) => {
          const D = n.data || {};
          return (
            <article key={n.id} className="wz-card overflow-hidden">
              <div className="grid md:grid-cols-[200px_1fr]">
                <div className="relative h-full min-h-[200px]">
                  <img src={COVER} alt="cover" className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--wz-bg)] to-transparent" />
                  <div className="absolute bottom-3 left-3 right-3">
                    <div className="overline">Workz Ventures · Broadcast</div>
                  </div>
                </div>
                <div className="p-6">
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <div className="overline">{D.issue_tagline || "Broadcast"}</div>
                    <span className={`pill ${
                      n.status === "dispatched" ? "pill-positive" :
                      n.status === "approved" ? "pill-gold" : "pill-amber"
                    }`}>{n.status}</span>
                  </div>
                  <h2 className="font-display text-2xl tracking-tight">{D.title || "Untitled broadcast"}</h2>

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

                  <div className="mt-5 flex gap-3 items-center flex-wrap">
                    {n.status === "draft" && (
                      <button onClick={() => approve(n.id)} data-testid={`approve-${n.id}`} className="wz-btn-ghost wz-btn flex items-center gap-2 text-sm">
                        <CheckCircle size={14} /> Approve
                      </button>
                    )}
                    {n.status !== "dispatched" && (
                      <button onClick={() => dispatch(n.id)} data-testid={`dispatch-${n.id}`} className="wz-btn wz-btn-gold flex items-center gap-2 text-sm">
                        <PaperPlaneTilt size={14} /> Send to buyers (mock)
                      </button>
                    )}
                    {n.status === "dispatched" && (
                      <div className="text-xs font-mono-wz text-[var(--wz-text-secondary)]">
                        broadcast → {n.recipients} buyers · {new Date(n.dispatched_at).toLocaleString()}
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
            No broadcasts yet. Draft your first issue above.
          </div>
        )}
      </div>
    </div>
  );
}
