import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { NotePencil, Tag } from "@phosphor-icons/react";

const COVER = "https://customer-assets.emergentagent.com/job_buyer-intel-lab/artifacts/mtl2u4cl_eb9c42c75e492db9ec952105c8ad0f0d.png";

const TYPES = [
  { v: "one_pager", l: "Deal one-pager" },
  { v: "email_sequence", l: "Email sequence" },
  { v: "linkedin_post", l: "LinkedIn post" },
  { v: "deal_memo", l: "Deal memo" },
];

const empty = {
  asset_type: "one_pager", deal_name: "", target_audience: "", key_points: "", tone: "professional-institutional",
};

export default function Collateral() {
  const { user } = useAuth();
  const isSellerLike = user?.role === "seller" || user?.role === "admin";

  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(null);
  const [list, setList] = useState([]);
  const [listings, setListings] = useState([]);
  const [selectedListingId, setSelectedListingId] = useState("");

  const load = () => api.get("/collateral").then((r) => setList(r.data));

  useEffect(() => {
    load();
    if (isSellerLike) {
      api.get("/listings").then((r) => setListings(r.data)).catch(() => {});
    }
  }, [isSellerLike]);

  const prefillFromListing = (listingId) => {
    setSelectedListingId(listingId);
    if (!listingId) return;
    const l = listings.find((x) => x.id === listingId);
    if (!l) return;
    const highlightsLine = (l.highlights || []).map((h) => `• ${h}`).join("\n");
    const financialLine = [
      l.revenue_usd_m ? `Revenue $${l.revenue_usd_m}M` : null,
      l.ebitda_usd_m ? `EBITDA $${l.ebitda_usd_m}M` : null,
      l.asking_price_usd_m ? `Asking $${l.asking_price_usd_m}M` : null,
      l.employees ? `${l.employees} employees` : null,
    ].filter(Boolean).join(" · ");
    setForm({
      asset_type: form.asset_type,
      deal_name: l.company_name,
      target_audience: `Strategic buyers in ${l.sector} (${l.geography})`,
      key_points: [l.summary, financialLine, highlightsLine].filter(Boolean).join("\n\n"),
      tone: form.tone,
    });
    toast.success(`Prefilled from ${l.company_name}`);
  };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setCurrent(null);
    try {
      const r = await api.post("/collateral/generate", form);
      setCurrent(r.data);
      toast.success("Collateral drafted");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const D = current?.data || {};

  return (
    <div data-testid="collateral-page" className="px-8 py-8">
      <div className="overline mb-3">Marketing collateral</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        AI-drafted assets, ready for the Vault.
      </h1>

      {isSellerLike && listings.length > 0 && (
        <div className="wz-card p-5 mt-8 flex flex-wrap items-center gap-4" data-testid="from-listing-bar">
          <div className="flex items-center gap-2">
            <Tag size={16} className="text-[var(--wz-amber)]" />
            <div className="overline">Generate from a listing</div>
          </div>
          <select
            data-testid="listing-picker"
            className="wz-input max-w-md"
            value={selectedListingId}
            onChange={(e) => prefillFromListing(e.target.value)}
          >
            <option value="">— pick a listing to prefill —</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.company_name} · {l.sector} · ${l.asking_price_usd_m}M · {l.status}
              </option>
            ))}
          </select>
          {selectedListingId && (
            <button
              type="button"
              onClick={() => { setForm(empty); setSelectedListingId(""); toast.success("Cleared"); }}
              data-testid="clear-prefill"
              className="text-xs font-mono-wz uppercase tracking-widest border border-[var(--wz-border)] px-3 py-1 hover:border-[var(--wz-text-tertiary)] transition-colors"
            >
              Clear & enter manually
            </button>
          )}
        </div>
      )}

      <form onSubmit={submit} data-mcp-action="collateral.generate" className="wz-card p-6 mt-6 grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="collateral-form">
        <label className="block">
          <div className="overline mb-2">Asset type</div>
          <select data-testid="col-type" className="wz-input" value={form.asset_type} onChange={(e) => setForm({ ...form, asset_type: e.target.value })}>
            {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </label>
        <label className="block">
          <div className="overline mb-2">Deal name</div>
          <input data-testid="col-deal" className="wz-input" required value={form.deal_name} onChange={(e) => setForm({ ...form, deal_name: e.target.value })} />
        </label>
        <label className="block md:col-span-2">
          <div className="overline mb-2">Target audience</div>
          <input data-testid="col-audience" className="wz-input" required value={form.target_audience} onChange={(e) => setForm({ ...form, target_audience: e.target.value })} placeholder="Tier-1 strategic buyers in MedTech" />
        </label>
        <label className="block md:col-span-2">
          <div className="overline mb-2">Key points</div>
          <textarea data-testid="col-points" className="wz-input font-sans" rows={5} required value={form.key_points} onChange={(e) => setForm({ ...form, key_points: e.target.value })} placeholder="Revenue $312M, EBITDA $84M, 38% YoY, dominant in DACH…" />
        </label>
        <div className="md:col-span-2 flex justify-end">
          <button data-testid="col-submit" type="submit" disabled={loading} className="wz-btn wz-btn-gold flex items-center gap-2">
            {loading ? "Drafting…" : (<><NotePencil size={16} /> Generate collateral</>)}
          </button>
        </div>
      </form>

      {current && (
        <div className="mt-8 wz-card overflow-hidden" data-testid="collateral-result">
          <div className="grid md:grid-cols-[280px_1fr]">
            <div className="relative h-full min-h-[260px]">
              <img src={COVER} alt="cover" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--wz-bg)]/80 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4">
                <div className="overline">{D.asset_type || form.asset_type}</div>
                <div className="font-display text-xl tracking-tight mt-1">{D.title || current.deal_name}</div>
              </div>
            </div>
            <div className="p-6">
              <h2 className="font-display text-2xl tracking-tight">{D.headline}</h2>
              <p className="text-[var(--wz-text-secondary)] mt-2">{D.subheadline}</p>
              <div className="mt-6 space-y-5">
                {(D.sections || []).map((s, i) => (
                  <div key={i}>
                    <div className="overline mb-2">{s.heading}</div>
                    <p className="text-sm leading-relaxed text-[var(--wz-text-secondary)] whitespace-pre-line">{s.body}</p>
                  </div>
                ))}
              </div>
              {D.cta && (
                <div className="mt-6 pt-5 border-t border-[var(--wz-border)] flex items-center justify-between">
                  <div className="overline">Call to action</div>
                  <span className="pill pill-gold">{D.cta}</span>
                </div>
              )}
              {D.compliance_note && (
                <div className="mt-3 text-[10px] uppercase tracking-widest font-mono-wz text-[var(--wz-text-tertiary)]">{D.compliance_note}</div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="mt-12">
        <div className="overline mb-4">Collateral history</div>
        <div className="wz-grid grid-cols-1 md:grid-cols-3" data-testid="collateral-history">
          {list.map((l) => (
            <button key={l.id} onClick={() => setCurrent(l)} className="p-5 text-left hover:bg-[var(--wz-surface-hover)] transition-colors">
              <div className="overline mb-2">{l.asset_type}</div>
              <div className="font-display tracking-tight">{l.deal_name}</div>
              <div className="text-xs text-[var(--wz-text-secondary)] mt-2 line-clamp-2">{l.data?.headline}</div>
              <div className="text-[10px] font-mono-wz mt-3 text-[var(--wz-text-tertiary)]">{new Date(l.created_at).toLocaleString()}</div>
            </button>
          ))}
          {list.length === 0 && <div className="p-8 text-sm text-[var(--wz-text-tertiary)] col-span-3">No collateral yet.</div>}
        </div>
      </div>
    </div>
  );
}
