import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Plus, Tag, Trash } from "@phosphor-icons/react";

const STATUSES = [
  { v: "draft", l: "Draft" },
  { v: "live", l: "Live" },
  { v: "under_loi", l: "Under LOI" },
  { v: "closed", l: "Closed" },
];

const emptyForm = {
  company_name: "", sector: "", geography: "", asking_price_usd_m: 0,
  revenue_usd_m: 0, ebitda_usd_m: 0, employees: 0,
  headline: "", summary: "", highlights: "", status: "draft",
};

export default function MyListings() {
  const [listings, setListings] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = () => api.get("/listings").then((r) => setListings(r.data));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const body = {
        ...form,
        asking_price_usd_m: Number(form.asking_price_usd_m),
        revenue_usd_m: Number(form.revenue_usd_m) || null,
        ebitda_usd_m: Number(form.ebitda_usd_m) || null,
        employees: Number(form.employees) || null,
        highlights: form.highlights.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      await api.post("/listings", body);
      toast.success("Listing created");
      setForm(emptyForm);
      setShow(false);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  const setStatus = async (l, status) => {
    try {
      await api.patch(`/listings/${l.id}`, {
        company_name: l.company_name, sector: l.sector, geography: l.geography,
        asking_price_usd_m: l.asking_price_usd_m, revenue_usd_m: l.revenue_usd_m,
        ebitda_usd_m: l.ebitda_usd_m, employees: l.employees,
        headline: l.headline, summary: l.summary, highlights: l.highlights || [],
        status,
      });
      toast.success(`${l.company_name} → ${status}`);
      load();
    } catch (err) {
      toast.error("Update failed");
    }
  };

  const remove = async (id) => {
    await api.delete(`/listings/${id}`);
    toast.success("Listing removed");
    load();
  };

  return (
    <div data-testid="listings-page" className="px-8 py-8">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="overline mb-3" style={{ color: "var(--wz-amber)" }}>Seller workspace</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">My listings</h1>
          <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-xl">
            Add portfolio companies for sale. Flip a listing to <span className="text-[var(--wz-positive)]">Live</span> to expose it on the buyer marketplace.
          </p>
        </div>
        <button data-testid="add-listing" onClick={() => setShow(!show)} className="wz-btn wz-btn-gold flex items-center gap-2">
          <Plus size={14} /> New listing
        </button>
      </div>

      {show && (
        <form onSubmit={submit} data-testid="listing-form" className="wz-card p-6 mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Company name" required value={form.company_name} onChange={(v) => setForm({ ...form, company_name: v })} tid="listing-name" />
          <Input label="Sector" required value={form.sector} onChange={(v) => setForm({ ...form, sector: v })} tid="listing-sector" />
          <Input label="Geography" required value={form.geography} onChange={(v) => setForm({ ...form, geography: v })} tid="listing-geo" />
          <Input label="Asking price (USD M)" type="number" required value={form.asking_price_usd_m} onChange={(v) => setForm({ ...form, asking_price_usd_m: v })} tid="listing-price" />
          <Input label="Revenue (USD M)" type="number" value={form.revenue_usd_m} onChange={(v) => setForm({ ...form, revenue_usd_m: v })} tid="listing-rev" />
          <Input label="EBITDA (USD M)" type="number" value={form.ebitda_usd_m} onChange={(v) => setForm({ ...form, ebitda_usd_m: v })} tid="listing-ebitda" />
          <Input label="Employees" type="number" value={form.employees} onChange={(v) => setForm({ ...form, employees: v })} tid="listing-emp" />
          <div>
            <div className="overline mb-2">Status</div>
            <select className="wz-input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} data-testid="listing-status">
              {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </div>
          <Input className="md:col-span-2" label="Headline" required value={form.headline} onChange={(v) => setForm({ ...form, headline: v })} tid="listing-headline" />
          <label className="md:col-span-2">
            <div className="overline mb-2">Summary</div>
            <textarea required rows={3} className="wz-input" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} data-testid="listing-summary" />
          </label>
          <label className="md:col-span-2">
            <div className="overline mb-2">Highlights (one per line)</div>
            <textarea rows={3} className="wz-input" value={form.highlights} onChange={(e) => setForm({ ...form, highlights: e.target.value })} data-testid="listing-highlights" placeholder="32 hospital systems under contract&#10;FDA + CE marked&#10;Founder-led, succession-ready" />
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShow(false)} className="wz-btn-ghost wz-btn">Cancel</button>
            <button type="submit" className="wz-btn wz-btn-gold" data-testid="listing-save">Create listing</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-testid="listing-grid">
        {listings.map((l) => (
          <div key={l.id} className="wz-card p-6">
            <div className="flex justify-between items-start gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Tag size={14} className="text-[var(--wz-amber)]" />
                  <span className={`pill ${l.status === "live" ? "pill-positive" : l.status === "under_loi" ? "pill-amber" : "pill-gold"}`}>{l.status}</span>
                  <span className="pill pill-gold">{l.sector}</span>
                </div>
                <div className="font-display text-2xl tracking-tight">{l.company_name}</div>
                <div className="text-sm text-[var(--wz-text-secondary)] mt-1">{l.headline}</div>
              </div>
              <button onClick={() => remove(l.id)} className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-negative)]" data-testid={`del-${l.id}`}>
                <Trash size={16} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-5">
              <Metric label="Asking" value={`$${l.asking_price_usd_m}M`} />
              <Metric label="Revenue" value={l.revenue_usd_m ? `$${l.revenue_usd_m}M` : "—"} />
              <Metric label="EBITDA" value={l.ebitda_usd_m ? `$${l.ebitda_usd_m}M` : "—"} />
            </div>

            <p className="text-sm text-[var(--wz-text-secondary)] mt-4 leading-relaxed">{l.summary}</p>

            {(l.highlights || []).length > 0 && (
              <ul className="mt-4 space-y-1 text-xs">
                {l.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2 text-[var(--wz-text-secondary)]">
                    <span className="text-[var(--wz-amber)]">▸</span>{h}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 pt-4 border-t border-[var(--wz-border)] flex items-center justify-between flex-wrap gap-3">
              <div className="text-xs font-mono-wz text-[var(--wz-text-secondary)]">
                {l.view_count} views · {l.inquiry_count} inquiries
              </div>
              <div className="flex flex-wrap gap-2" data-testid={`status-buttons-${l.id}`}>
                {STATUSES.filter((s) => s.v !== l.status).map((s) => (
                  <button
                    key={s.v}
                    onClick={() => setStatus(l, s.v)}
                    className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-border)] px-2 py-1 hover:border-[var(--wz-amber)] hover:text-[var(--wz-amber)] transition-colors"
                    data-testid={`set-${l.id}-${s.v}`}
                  >
                    → {s.l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
        {listings.length === 0 && (
          <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)] md:col-span-2">
            No listings yet — create your first one above.
          </div>
        )}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", required, className = "", tid }) {
  return (
    <label className={`block ${className}`}>
      <div className="overline mb-2">{label}</div>
      <input
        type={type}
        required={required}
        className="wz-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={tid}
      />
    </label>
  );
}

function Metric({ label, value }) {
  return (
    <div className="border border-[var(--wz-border)] p-2">
      <div className="overline mb-1">{label}</div>
      <div className="font-mono-wz text-sm">{value}</div>
    </div>
  );
}
