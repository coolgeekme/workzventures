import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChartLineUp, PlusCircle, X, Buildings, PencilSimple, Trash, Info,
} from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useFundContext } from "../lib/fundContext";

/**
 * Fund Dashboard (Phase 2).
 *
 * Scoped to whichever fund the top-bar switcher has selected. Every figure
 * here is computed from commitments actually recorded — the metrics that need
 * capital-call history (NAV, TVPI, DPI, net IRR) are listed separately as not
 * yet available rather than rendered as zeros, which would read as a fund with
 * no value rather than a number we cannot compute yet.
 */

function money(n, currency = "USD") {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  const [div, suffix] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
  const v = n / div;
  const s = suffix ? v.toFixed(v >= 100 ? 0 : 1) : v.toFixed(0);
  const sym = currency === "USD" ? "$" : "";
  return `${sym}${s}${suffix}`;
}

function Tile({ label, value, sub, muted, testid }) {
  return (
    <div className={`wz-card p-4 ${muted ? "opacity-60" : ""}`} data-testid={testid}>
      <div className="overline mb-1">{label}</div>
      <div className="font-display text-2xl tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-[var(--wz-text-tertiary)] mt-1">{sub}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <div className="overline mb-1.5">{label}</div>
      {children}
    </label>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8">
      <div className="wz-card w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display tracking-tight">{title}</h3>
          <button onClick={onClose} className="wz-btn wz-btn-ghost p-1"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FundModal({ onClose, onSaved }) {
  const [f, setF] = useState({ name: "", target: "", hard_cap: "", vintage_year: "", status: "raising", currency: "USD" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/funds", {
        name: f.name,
        target: f.target ? Number(f.target) : null,
        hard_cap: f.hard_cap ? Number(f.hard_cap) : null,
        vintage_year: f.vintage_year ? Number(f.vintage_year) : null,
        status: f.status,
        currency: f.currency,
      });
      toast.success("Fund created");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create the fund");
    } finally { setBusy(false); }
  };
  return (
    <ModalShell title="New fund" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Fund name">
          <input data-testid="fund-name" required className="wz-input" value={f.name}
                 onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Bluewater Capital Fund I" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target size">
            <input data-testid="fund-target" type="number" className="wz-input" value={f.target}
                   onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="25000000" />
          </Field>
          <Field label="Hard cap">
            <input data-testid="fund-hardcap" type="number" className="wz-input" value={f.hard_cap}
                   onChange={(e) => setF({ ...f, hard_cap: e.target.value })} placeholder="35000000" />
          </Field>
          <Field label="Vintage year">
            <input data-testid="fund-vintage" type="number" className="wz-input" value={f.vintage_year}
                   onChange={(e) => setF({ ...f, vintage_year: e.target.value })} placeholder="2024" />
          </Field>
          <Field label="Status">
            <select data-testid="fund-status" className="wz-input" value={f.status}
                    onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="raising">Raising</option>
              <option value="active">Active</option>
              <option value="harvesting">Harvesting</option>
              <option value="closed">Closed</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="wz-btn wz-btn-ghost text-xs">Cancel</button>
          <button data-testid="fund-submit" disabled={busy} className="wz-btn wz-btn-gold text-xs">
            {busy ? "Creating…" : "Create fund"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function CommitmentModal({ fundId, existing, onClose, onSaved }) {
  const [f, setF] = useState({
    lp_name: existing?.lp_name || "",
    lp_email: existing?.lp_email || "",
    committed: existing?.committed ?? "",
    paid_in: existing?.paid_in ?? 0,
    distributed: existing?.distributed ?? 0,
    notes: existing?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const body = {
      lp_name: f.lp_name,
      lp_email: f.lp_email || null,
      committed: Number(f.committed),
      paid_in: Number(f.paid_in || 0),
      distributed: Number(f.distributed || 0),
      notes: f.notes,
    };
    try {
      if (existing) await api.patch(`/funds/${fundId}/commitments/${existing.id}`, body);
      else await api.post(`/funds/${fundId}/commitments`, body);
      toast.success(existing ? "Commitment updated" : "Commitment added");
      onSaved();
    } catch (err) {
      // The API rejects paid-in above the commitment and negative amounts —
      // surface its message rather than a generic failure.
      toast.error(err?.response?.data?.detail || "Could not save");
    } finally { setBusy(false); }
  };
  return (
    <ModalShell title={existing ? `Edit · ${existing.lp_name}` : "Add LP commitment"} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Limited partner">
          <input data-testid="lp-name" required className="wz-input" value={f.lp_name}
                 onChange={(e) => setF({ ...f, lp_name: e.target.value })} placeholder="Riverside Family Office" />
        </Field>
        <Field label="Contact email">
          <input data-testid="lp-email" type="email" className="wz-input" value={f.lp_email}
                 onChange={(e) => setF({ ...f, lp_email: e.target.value })} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Committed">
            <input data-testid="lp-committed" required type="number" className="wz-input" value={f.committed}
                   onChange={(e) => setF({ ...f, committed: e.target.value })} />
          </Field>
          <Field label="Paid in">
            <input data-testid="lp-paidin" type="number" className="wz-input" value={f.paid_in}
                   onChange={(e) => setF({ ...f, paid_in: e.target.value })} />
          </Field>
          <Field label="Distributed">
            <input data-testid="lp-distributed" type="number" className="wz-input" value={f.distributed}
                   onChange={(e) => setF({ ...f, distributed: e.target.value })} />
          </Field>
        </div>
        <Field label="Notes">
          <input data-testid="lp-notes" className="wz-input" value={f.notes}
                 onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="wz-btn wz-btn-ghost text-xs">Cancel</button>
          <button data-testid="lp-submit" disabled={busy} className="wz-btn wz-btn-gold text-xs">
            {busy ? "Saving…" : existing ? "Save" : "Add commitment"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export default function FundDashboard() {
  const { funds, fundId, activeFund, loading: fundsLoading, reloadFunds } = useFundContext(true);
  const [data, setData] = useState(null);
  const [commitments, setCommitments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newFund, setNewFund] = useState(false);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new

  const load = useCallback(async () => {
    if (!fundId) { setData(null); setCommitments([]); return; }
    setLoading(true);
    try {
      const [d, c] = await Promise.all([
        api.get(`/funds/${fundId}/dashboard`),
        api.get(`/funds/${fundId}/commitments`),
      ]);
      setData(d.data);
      setCommitments(c.data || []);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not load the fund");
    } finally { setLoading(false); }
  }, [fundId]);

  useEffect(() => { load(); }, [load]);

  const removeCommitment = async (c) => {
    if (!window.confirm(`Remove ${c.lp_name}'s commitment?`)) return;
    try {
      await api.delete(`/funds/${fundId}/commitments/${c.id}`);
      toast.success("Removed");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not remove");
    }
  };

  const cur = activeFund?.currency || "USD";
  const t = data?.totals || {};
  const p = data?.progress || {};

  return (
    <div data-testid="fund-dashboard" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium flex items-center gap-3">
          <ChartLineUp size={28} className="text-[var(--wz-gold)]" />
          Fund Dashboard
        </h1>
        <div className="ml-auto flex gap-2">
          <button data-testid="fund-new" className="wz-btn wz-btn-gold flex items-center gap-2"
                  onClick={() => setNewFund(true)}>
            <PlusCircle size={14} /> New fund
          </button>
        </div>
      </div>
      <p className="text-sm text-[var(--wz-text-secondary)] mb-6">
        {activeFund
          ? <>Overview of <span className="text-[var(--wz-text)]">{activeFund.name}</span> performance and key metrics.</>
          : "Create a fund to begin tracking commitments and capital."}
      </p>

      {/* No funds at all */}
      {!fundsLoading && funds.length === 0 && (
        <div className="wz-card p-10 text-center" data-testid="fund-empty">
          <Buildings size={28} className="mx-auto mb-3 text-[var(--wz-text-tertiary)]" />
          <div className="font-display tracking-tight mb-1">No funds yet</div>
          <p className="text-sm text-[var(--wz-text-secondary)] max-w-sm mx-auto mb-4">
            Create your first fund to start recording LP commitments. The switcher in the
            top bar scopes every fund page to whichever one you select.
          </p>
          <button className="wz-btn wz-btn-gold" onClick={() => setNewFund(true)}>Create a fund</button>
        </div>
      )}

      {data && (
        <>
          <div className="wz-grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 mb-6">
            <Tile testid="tile-target" label="Fund target" value={money(t.target, cur)} />
            <Tile testid="tile-hardcap" label="Hard cap" value={money(t.hard_cap, cur)} />
            <Tile testid="tile-committed" label="Total commitments" value={money(t.committed, cur)}
                  sub={p.committed_vs_target != null ? `${p.committed_vs_target}% of target` : null} />
            <Tile testid="tile-paidin" label="Paid-in capital" value={money(t.paid_in, cur)}
                  sub={p.called_pct != null ? `${p.called_pct}% of commitments` : null} />
            <Tile testid="tile-distributed" label="Distributions" value={money(t.distributed, cur)} />
            <Tile testid="tile-unfunded" label="Unfunded" value={money(t.unfunded, cur)}
                  sub={`${data.lp_count} limited partner${data.lp_count === 1 ? "" : "s"}`} />
          </div>

          {/* Deliberately separated: these need capital-call history (Phase 6).
              Shown as pending rather than zero, so nobody reads them as real. */}
          {data.not_yet_available?.length > 0 && (
            <div className="wz-card p-4 mb-6" data-testid="pending-metrics">
              <div className="flex items-start gap-2">
                <Info size={15} className="text-[var(--wz-text-tertiary)] mt-0.5" />
                <div>
                  <div className="overline mb-1">Not yet available</div>
                  <p className="text-xs text-[var(--wz-text-secondary)]">
                    {data.not_yet_available.map((m) => m.toUpperCase().replace("_", " ")).join(" · ")}
                    {" — these need capital-call and valuation history, which arrives with capital activity. "}
                    They are left blank rather than shown as zero so nothing here reads as a real figure.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="wz-card p-0 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--wz-border)]">
              <div className="overline">Limited partners</div>
              <button data-testid="lp-add" className="ml-auto wz-btn wz-btn-ghost text-[11px] flex items-center gap-1"
                      onClick={() => setEditing(null)}>
                <PlusCircle size={12} /> Add commitment
              </button>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left">
                  <th className="overline px-4 py-2">Limited partner</th>
                  <th className="overline px-4 py-2 text-right">Committed</th>
                  <th className="overline px-4 py-2 text-right">Paid in</th>
                  <th className="overline px-4 py-2 text-right">Distributed</th>
                  <th className="overline px-4 py-2 text-right">Unfunded</th>
                  <th className="overline px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {commitments.length === 0 && !loading && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--wz-text-tertiary)]">
                    No commitments recorded yet.
                  </td></tr>
                )}
                {commitments.map((c) => (
                  <tr key={c.id} data-testid={`lp-row-${c.id}`} className="border-t border-[var(--wz-border)]">
                    <td className="px-4 py-2.5">
                      <div>{c.lp_name}</div>
                      {c.lp_email && <div className="text-[10px] text-[var(--wz-text-tertiary)]">{c.lp_email}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono-wz">{money(c.committed, cur)}</td>
                    <td className="px-4 py-2.5 text-right font-mono-wz">{money(c.paid_in, cur)}</td>
                    <td className="px-4 py-2.5 text-right font-mono-wz">{money(c.distributed, cur)}</td>
                    <td className="px-4 py-2.5 text-right font-mono-wz text-[var(--wz-text-secondary)]">{money(c.unfunded, cur)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button className="wz-btn wz-btn-ghost text-[11px] mr-1" onClick={() => setEditing(c)} title="Edit">
                        <PencilSimple size={12} />
                      </button>
                      <button className="wz-btn wz-btn-ghost text-[11px] text-[var(--wz-negative)]"
                              onClick={() => removeCommitment(c)} title="Remove">
                        <Trash size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-[var(--wz-text-tertiary)] mt-4">
            All figures are computed from recorded commitments. Values are unaudited and subject to change.
          </div>
        </>
      )}

      {newFund && (
        <FundModal onClose={() => setNewFund(false)}
                   onSaved={() => { setNewFund(false); reloadFunds(); }} />
      )}
      {editing !== undefined && fundId && (
        <CommitmentModal fundId={fundId} existing={editing}
                         onClose={() => setEditing(undefined)}
                         onSaved={() => { setEditing(undefined); load(); }} />
      )}
    </div>
  );
}
