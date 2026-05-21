import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  NotePencil, Tag, Download, Files, PaperPlaneTilt, Trash, PencilSimple, Check, X, Paperclip,
} from "@phosphor-icons/react";

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

  return (
    <div data-testid="collateral-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
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
        <CollateralPreview
          current={current}
          onChange={(updated) => {
            setCurrent(updated);
            load();
          }}
          onDelete={() => {
            setCurrent(null);
            load();
          }}
          listings={listings}
        />
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

function CollateralPreview({ current, onChange, onDelete, listings }) {
  const D = current.data || {};
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [headline, setHeadline] = useState(D.headline || "");
  const [subheadline, setSubheadline] = useState(D.subheadline || "");
  const [cta, setCta] = useState(D.cta || "");
  const [sections, setSections] = useState(D.sections || []);
  const [rooms, setRooms] = useState([]);
  const [inquiries, setInquiries] = useState([]);
  const [pushTarget, setPushTarget] = useState("");
  const [sendTarget, setSendTarget] = useState("");
  const [attachTarget, setAttachTarget] = useState("");

  useEffect(() => {
    api.get("/deal-rooms").then((r) => setRooms(r.data.filter((x) => x.status === "active"))).catch(() => {});
    api.get("/inquiries").then((r) => setInquiries(r.data)).catch(() => {});
  }, []);
  useEffect(() => {
    setHeadline(D.headline || ""); setSubheadline(D.subheadline || ""); setCta(D.cta || ""); setSections(D.sections || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id]);

  const saveEdit = async () => {
    setBusy(true);
    try {
      const r = await api.patch(`/collateral/${current.id}`, { headline, subheadline, cta, sections });
      onChange?.(r.data);
      toast.success("Collateral updated");
      setEditing(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm("Delete this collateral permanently?")) return;
    setBusy(true);
    try {
      await api.delete(`/collateral/${current.id}`);
      toast.success("Collateral deleted");
      onDelete?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Delete failed");
    } finally { setBusy(false); }
  };

  const exportPdf = async () => {
    try {
      const r = await api.get(`/collateral/${current.id}/pdf`, { responseType: "blob" });
      const blob = new Blob([r.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `workz-${(D.title || current.deal_name || "collateral").toLowerCase().replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("PDF downloaded");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Export failed");
    }
  };

  const pushToVault = async () => {
    if (!pushTarget) return toast.error("Select a Vault first");
    setBusy(true);
    try {
      await api.post(`/collateral/${current.id}/push-to-vault`, { room_id: pushTarget, folder: "commercial" });
      toast.success("Pushed to Vault · encrypted + Bitcoin-anchored");
      setPushTarget("");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Push failed");
    } finally { setBusy(false); }
  };

  const sendToInquiry = async () => {
    if (!sendTarget) return toast.error("Select an inquiry first");
    setBusy(true);
    try {
      await api.post(`/collateral/${current.id}/send-to-inquiry`, { inquiry_id: sendTarget });
      toast.success("Sent into inquiry thread");
      setSendTarget("");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Send failed");
    } finally { setBusy(false); }
  };

  const attachToListing = async () => {
    if (!attachTarget) return toast.error("Select a listing first");
    setBusy(true);
    try {
      await api.post(`/collateral/${current.id}/attach-to-listing`, { listing_id: attachTarget });
      toast.success("Attached to listing — visible on marketplace card");
      setAttachTarget("");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Attach failed");
    } finally { setBusy(false); }
  };

  const updateSection = (i, key, val) => {
    setSections(sections.map((s, idx) => idx === i ? { ...s, [key]: val } : s));
  };

  return (
    <div className="mt-8 wz-card overflow-hidden" data-testid="collateral-result">
      <div className="grid md:grid-cols-[280px_1fr]">
        <div className="relative h-full min-h-[260px]">
          <img src={COVER} alt="cover" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--wz-bg)]/80 to-transparent" />
          <div className="absolute bottom-4 left-4 right-4">
            <div className="overline">{D.asset_type || current.asset_type}</div>
            <div className="font-display text-xl tracking-tight mt-1">{D.title || current.deal_name}</div>
          </div>
        </div>
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4 flex-wrap" data-testid="collateral-actions">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="wz-btn-ghost wz-btn text-xs flex items-center gap-1.5" data-testid="coll-edit"><PencilSimple size={12}/> Edit</button>
            ) : (
              <>
                <button onClick={saveEdit} disabled={busy} className="wz-btn wz-btn-gold text-xs flex items-center gap-1.5" data-testid="coll-save"><Check size={12}/> Save version</button>
                <button onClick={() => { setEditing(false); setHeadline(D.headline||""); setSubheadline(D.subheadline||""); setCta(D.cta||""); setSections(D.sections||[]); }} className="wz-btn-ghost wz-btn text-xs flex items-center gap-1.5"><X size={12}/> Cancel</button>
              </>
            )}
            <button onClick={exportPdf} className="wz-btn-ghost wz-btn text-xs flex items-center gap-1.5" data-testid="coll-pdf"><Download size={12}/> Download PDF</button>
            <button onClick={remove} disabled={busy} className="wz-btn-ghost wz-btn text-xs flex items-center gap-1.5 hover:!text-[var(--wz-negative)] hover:!border-[var(--wz-negative)]" data-testid="coll-delete"><Trash size={12}/> Delete</button>
          </div>

          {editing ? (
            <>
              <label className="block mb-3">
                <div className="overline mb-1">Headline</div>
                <input className="wz-input" value={headline} onChange={(e) => setHeadline(e.target.value)} data-testid="coll-headline-edit" />
              </label>
              <label className="block mb-3">
                <div className="overline mb-1">Subheadline</div>
                <input className="wz-input" value={subheadline} onChange={(e) => setSubheadline(e.target.value)} />
              </label>
              <div className="mt-2 space-y-3">
                {sections.map((s, i) => (
                  <div key={i} className="border border-[var(--wz-border)] p-3">
                    <input className="wz-input mb-2 font-display" placeholder="Heading" value={s.heading || ""} onChange={(e) => updateSection(i, "heading", e.target.value)} />
                    <textarea className="wz-input text-xs" rows={3} placeholder="Body" value={s.body || ""} onChange={(e) => updateSection(i, "body", e.target.value)} />
                  </div>
                ))}
              </div>
              <label className="block mt-3">
                <div className="overline mb-1">CTA</div>
                <input className="wz-input" value={cta} onChange={(e) => setCta(e.target.value)} />
              </label>
            </>
          ) : (
            <>
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
            </>
          )}

          {/* Distribution actions */}
          {!editing && (
            <div className="mt-8 pt-6 border-t border-[var(--wz-border)] grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="coll-distribution">
              <div>
                <div className="overline mb-1.5 flex items-center gap-1.5"><Paperclip size={11}/> Attach to listing</div>
                <select value={attachTarget} onChange={(e) => setAttachTarget(e.target.value)} className="wz-input text-xs mb-2" data-testid="coll-attach-listing-select">
                  <option value="">— select —</option>
                  {(listings || []).map((l) => <option key={l.id} value={l.id}>{l.company_name || l.name}</option>)}
                </select>
                <button onClick={attachToListing} disabled={busy || !attachTarget} className="w-full text-xs border border-[var(--wz-border)] hover:border-[var(--wz-gold)] hover:text-[var(--wz-gold)] py-1.5 transition-colors" data-testid="coll-attach-btn">Attach</button>
              </div>
              <div>
                <div className="overline mb-1.5 flex items-center gap-1.5"><Files size={11}/> Push to Vault</div>
                <select value={pushTarget} onChange={(e) => setPushTarget(e.target.value)} className="wz-input text-xs mb-2" data-testid="coll-vault-select">
                  <option value="">— active vault —</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.listing_name} · {r.buyer_name}</option>)}
                </select>
                <button onClick={pushToVault} disabled={busy || !pushTarget} className="w-full text-xs border border-[var(--wz-border)] hover:border-[var(--wz-amber)] hover:text-[var(--wz-amber)] py-1.5 transition-colors" data-testid="coll-vault-btn">Push (encrypted)</button>
              </div>
              <div>
                <div className="overline mb-1.5 flex items-center gap-1.5"><PaperPlaneTilt size={11}/> Send to inquiry</div>
                <select value={sendTarget} onChange={(e) => setSendTarget(e.target.value)} className="wz-input text-xs mb-2" data-testid="coll-inquiry-select">
                  <option value="">— inquiry —</option>
                  {inquiries.map((i) => <option key={i.id} value={i.id}>{i.buyer_name} · {i.listing_name}</option>)}
                </select>
                <button onClick={sendToInquiry} disabled={busy || !sendTarget} className="w-full text-xs border border-[var(--wz-border)] hover:border-[var(--wz-positive)] hover:text-[var(--wz-positive)] py-1.5 transition-colors" data-testid="coll-inquiry-btn">Send</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
