import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Plus } from "@phosphor-icons/react";

const STAGES = [
  { v: "new", l: "New" },
  { v: "qualified", l: "Qualified" },
  { v: "engaged", l: "Engaged" },
  { v: "negotiation", l: "Negotiation" },
  { v: "closed", l: "Closed" },
];

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [form, setForm] = useState({ name: "", company: "", title: "", email: "" });
  const [show, setShow] = useState(false);

  const load = () => api.get("/leads").then((r) => setLeads(r.data));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      await api.post("/leads", form);
      toast.success("Lead added");
      setForm({ name: "", company: "", title: "", email: "" });
      setShow(false);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  const advance = async (lead, stage) => {
    try {
      await api.patch(`/leads/${lead.id}/stage`, { stage });
      toast.success(`${lead.name} → ${stage}`);
      load();
    } catch (err) {
      toast.error("Failed to update stage");
    }
  };

  return (
    <div data-testid="leads-page" data-mcp-action="leads.list" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="overline mb-3">Lead nurturing pipeline</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">Pipeline kanban</h1>
        </div>
        <button data-testid="add-lead" onClick={() => setShow(!show)} className="wz-btn wz-btn-gold flex items-center gap-2">
          <Plus size={14} /> Add lead
        </button>
      </div>

      {show && (
        <form onSubmit={create} className="wz-card p-5 mb-8 grid grid-cols-1 md:grid-cols-4 gap-3" data-testid="lead-form">
          <input required placeholder="Name" className="wz-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="lead-name" />
          <input required placeholder="Company" className="wz-input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} data-testid="lead-company" />
          <input required placeholder="Title" className="wz-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="lead-title" />
          <input type="email" placeholder="Email" className="wz-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="lead-email" />
          <div className="md:col-span-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShow(false)} className="wz-btn-ghost wz-btn">Cancel</button>
            <button type="submit" className="wz-btn wz-btn-gold" data-testid="lead-save">Save lead</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4" data-testid="kanban">
        {STAGES.map((s) => {
          const items = leads.filter((l) => l.stage === s.v);
          return (
            <div key={s.v} className="wz-card">
              <div className="border-b border-[var(--wz-border)] px-4 py-3 flex items-center justify-between">
                <div className="overline">{s.l}</div>
                <span className="font-mono-wz text-xs text-[var(--wz-text-secondary)]">{items.length}</span>
              </div>
              <div className="p-3 space-y-3 min-h-[180px]">
                {items.map((l) => (
                  <div key={l.id} className="border border-[var(--wz-border)] p-3 hover:border-[var(--wz-text-tertiary)] transition-colors" data-testid={`lead-card-${l.id}`}>
                    <div className="font-medium text-sm">{l.name}</div>
                    <div className="text-xs text-[var(--wz-text-secondary)] mt-1">{l.title}</div>
                    <div className="text-xs text-[var(--wz-text-tertiary)]">{l.company}</div>
                    <div className="flex flex-wrap gap-1 mt-3" data-mcp-action="leads.advance">
                      {STAGES.filter((x) => x.v !== l.stage).map((x) => (
                        <button
                          key={x.v}
                          onClick={() => advance(l, x.v)}
                          className="text-[10px] font-mono-wz uppercase tracking-widest border border-[var(--wz-border)] px-2 py-1 hover:border-[var(--wz-gold)] hover:text-[var(--wz-gold)] transition-colors"
                          data-testid={`advance-${l.id}-${x.v}`}
                        >
                          → {x.l}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="text-[10px] font-mono-wz uppercase tracking-widest text-[var(--wz-text-tertiary)] text-center py-6">
                    — empty —
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
