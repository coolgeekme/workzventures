import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { PaperPlaneTilt, Rocket } from "@phosphor-icons/react";

export default function Outreach() {
  const [form, setForm] = useState({
    name: "", target_persona: "", channel: "linkedin", audience_size: 50, message_brief: "",
  });
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState([]);

  const load = () => api.get("/outreach/campaigns").then((r) => setCampaigns(r.data));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/outreach/campaigns", form);
      toast.success("Campaign drafted by AI");
      setForm({ ...form, name: "", target_persona: "", message_brief: "" });
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    } finally {
      setLoading(false);
    }
  };

  const launch = async (id) => {
    try {
      const r = await api.post(`/outreach/campaigns/${id}/launch`);
      toast.success(`Launched · ${r.data.sent_count} prospects`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Launch failed");
    }
  };

  return (
    <div data-testid="outreach-page" className="px-8 py-8">
      <div className="overline mb-3">Outreach campaigns</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        Personalized social outreach at agency scale.
      </h1>

      <form onSubmit={submit} data-mcp-action="outreach.campaign.create" className="wz-card p-6 mt-8 grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="outreach-form">
        <label className="block">
          <div className="overline mb-2">Campaign name</div>
          <input data-testid="o-name" required className="wz-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Q1 EU MedTech buyers" />
        </label>
        <label className="block">
          <div className="overline mb-2">Channel</div>
          <select data-testid="o-channel" className="wz-input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
            <option value="linkedin">LinkedIn</option>
            <option value="email">Email</option>
          </select>
        </label>
        <label className="block">
          <div className="overline mb-2">Target persona</div>
          <input data-testid="o-persona" required className="wz-input" value={form.target_persona} onChange={(e) => setForm({ ...form, target_persona: e.target.value })} placeholder="CIOs at Tier-1 industrial buyers" />
        </label>
        <label className="block">
          <div className="overline mb-2">Audience size</div>
          <input data-testid="o-size" type="number" min={1} className="wz-input" value={form.audience_size} onChange={(e) => setForm({ ...form, audience_size: Number(e.target.value) })} />
        </label>
        <label className="block md:col-span-2">
          <div className="overline mb-2">Message brief</div>
          <textarea data-testid="o-brief" rows={3} required className="wz-input" value={form.message_brief} onChange={(e) => setForm({ ...form, message_brief: e.target.value })} placeholder="Position Project Helios as a category-defining EMEA industrial-tech consolidation opportunity…" />
        </label>
        <div className="md:col-span-2 flex justify-end">
          <button data-testid="o-submit" type="submit" disabled={loading} className="wz-btn wz-btn-gold flex items-center gap-2">
            {loading ? "Drafting…" : (<><PaperPlaneTilt size={16} /> Draft campaign</>)}
          </button>
        </div>
      </form>

      <div className="mt-10">
        <div className="overline mb-4">Campaigns</div>
        <div className="space-y-4" data-testid="campaign-list">
          {campaigns.map((c) => (
            <div key={c.id} className="wz-card p-6">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="font-display text-xl tracking-tight">{c.name}</div>
                    <span className={`pill ${c.status === "launched" ? "pill-positive" : "pill-amber"}`}>{c.status}</span>
                    <span className="pill pill-gold">{c.channel}</span>
                  </div>
                  <div className="text-sm text-[var(--wz-text-secondary)]">{c.target_persona}</div>

                  <div className="mt-4 grid md:grid-cols-2 gap-4">
                    <div className="border border-[var(--wz-border)] p-3">
                      <div className="overline mb-1">LinkedIn message</div>
                      <div className="text-xs leading-relaxed whitespace-pre-line">{c.draft?.linkedin_message || c.draft?.opening || "—"}</div>
                    </div>
                    <div className="border border-[var(--wz-border)] p-3">
                      <div className="overline mb-1">Email body</div>
                      <div className="text-xs leading-relaxed whitespace-pre-line">{c.draft?.email_body || c.draft?.opening || "—"}</div>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono-wz text-2xl">{c.sent_count}/{c.audience_size}</div>
                  <div className="overline mt-1">prospects sent</div>
                  {c.status !== "launched" && (
                    <button data-testid={`launch-${c.id}`} onClick={() => launch(c.id)} className="wz-btn mt-4 flex items-center gap-2 text-sm">
                      <Rocket size={14} /> Launch (mocked)
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {campaigns.length === 0 && (
            <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)]">No campaigns yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
