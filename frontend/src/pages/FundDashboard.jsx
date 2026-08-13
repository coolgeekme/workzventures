import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChartLineUp, PlusCircle, X, Buildings, PencilSimple, Trash, Info,
  ArrowDown, ArrowUp,
} from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useFundContext } from "../lib/fundContext";

/**
 * Fund Dashboard (Phases 2–3).
 *
 * Scoped to whichever fund the top-bar switcher has selected. Every figure
 * here is computed from records actually entered — commitments, and the
 * capital calls and distributions below them. Paid-in and distributed capital
 * are never typed in: they are the sum of a fund's capital events, so an LP's
 * balance and the fund's activity history cannot disagree.
 *
 * NAV, TVPI and net IRR still need portfolio valuations, so they are listed as
 * not yet available rather than rendered as zeros — a zero would read as a
 * fund with no value rather than a number we cannot compute yet.
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
      notes: f.notes,
    };
    try {
      if (existing) await api.patch(`/funds/${fundId}/commitments/${existing.id}`, body);
      else await api.post(`/funds/${fundId}/commitments`, body);
      toast.success(existing ? "Commitment updated" : "Commitment added");
      onSaved();
    } catch (err) {
      // The API rejects a commitment below what the LP has already funded —
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
        <Field label="Committed">
          <input data-testid="lp-committed" required type="number" className="wz-input" value={f.committed}
                 onChange={(e) => setF({ ...f, committed: e.target.value })} />
        </Field>
        <p className="text-[11px] text-[var(--wz-text-tertiary)] -mt-1 mb-3">
          Paid-in and distributed capital are no longer entered here — they come from the
          capital calls and distributions recorded below, so an LP&rsquo;s balance always
          matches the fund&rsquo;s activity.
        </p>
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

function CapitalEventModal({ fundId, kind, onClose, onSaved }) {
  const isCall = kind === "call";
  const [f, setF] = useState({
    event_date: new Date().toISOString().slice(0, 10),
    amount: "",
    label: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/funds/${fundId}/capital-events`, {
        kind,
        event_date: f.event_date,
        amount: Number(f.amount),
        label: f.label,
        notes: f.notes,
      });
      toast.success(isCall ? "Capital call recorded" : "Distribution recorded");
      onSaved();
    } catch (err) {
      // The API refuses a call above remaining unfunded capital, and a
      // distribution before anything has been called. Show its wording.
      toast.error(err?.response?.data?.detail || "Could not record");
    } finally { setBusy(false); }
  };
  return (
    <ModalShell title={isCall ? "Record capital call" : "Record distribution"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input data-testid="cap-date" required type="date" className="wz-input" value={f.event_date}
                   onChange={(e) => setF({ ...f, event_date: e.target.value })} />
          </Field>
          <Field label="Total amount">
            <input data-testid="cap-amount" required type="number" className="wz-input" value={f.amount}
                   onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
        </div>
        <Field label="Label">
          <input data-testid="cap-label" className="wz-input" value={f.label}
                 onChange={(e) => setF({ ...f, label: e.target.value })}
                 placeholder={isCall ? "Call #1" : "Q3 distribution"} />
        </Field>
        <Field label="Notes">
          <input data-testid="cap-notes" className="wz-input" value={f.notes}
                 onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <p className="text-[11px] text-[var(--wz-text-tertiary)] mb-3">
          {isCall
            ? "Split across LPs in proportion to their commitments."
            : "Split across LPs in proportion to capital they have actually funded — an LP who has funded nothing is owed nothing back."}
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="wz-btn wz-btn-ghost text-xs">Cancel</button>
          <button data-testid="cap-submit" disabled={busy} className="wz-btn wz-btn-gold text-xs">
            {busy ? "Recording…" : isCall ? "Record call" : "Record distribution"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/**
 * Cumulative called vs distributed capital.
 *
 * Hand-drawn SVG on a fixed numeric viewBox — SVG geometry attributes take
 * user-space numbers only, so no CSS units or percentages appear in any path.
 */
function CapitalChart({ points, committed, currency }) {
  const W = 640, H = 180, PAD_L = 8, PAD_R = 8, PAD_T = 12, PAD_B = 22;
  if (!points || points.length === 0) return null;

  const peak = Math.max(
    committed || 0,
    ...points.map((p) => Math.max(p.cumulative_called, p.cumulative_distributed)),
    1,
  );
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  // A single event has no span to spread across, so pin it to the right edge
  // rather than dividing by zero.
  const x = (i) => PAD_L + (points.length === 1 ? innerW : (i / (points.length - 1)) * innerW);
  const y = (v) => PAD_T + innerH - (v / peak) * innerH;

  const line = (key) => points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(2)} ${y(p[key]).toFixed(2)}`).join(" ");
  const area = (key) =>
    `${line(key)} L ${x(points.length - 1).toFixed(2)} ${(PAD_T + innerH).toFixed(2)} L ${x(0).toFixed(2)} ${(PAD_T + innerH).toFixed(2)} Z`;

  const committedY = committed ? y(committed) : null;

  return (
    <div className="overflow-x-auto" data-testid="capital-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px]" role="img"
           aria-label="Cumulative called and distributed capital over time">
        {committedY !== null && (
          <>
            <line x1={PAD_L} y1={committedY} x2={W - PAD_R} y2={committedY}
                  stroke="var(--wz-border)" strokeWidth="1" strokeDasharray="3 3" />
            <text x={PAD_L} y={committedY - 4} fontSize="9" fill="var(--wz-text-tertiary)">
              committed {money(committed, currency)}
            </text>
          </>
        )}
        <path d={area("cumulative_called")} fill="var(--wz-gold)" opacity="0.12" />
        <path d={line("cumulative_called")} fill="none" stroke="var(--wz-gold)" strokeWidth="1.75" />
        <path d={line("cumulative_distributed")} fill="none" stroke="var(--wz-positive)"
              strokeWidth="1.75" strokeDasharray="4 3" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.cumulative_called)} r="2.5" fill="var(--wz-gold)" />
        ))}
        <text x={PAD_L} y={H - 6} fontSize="9" fill="var(--wz-text-tertiary)">{points[0].date}</text>
        {points.length > 1 && (
          <text x={W - PAD_R} y={H - 6} fontSize="9" textAnchor="end" fill="var(--wz-text-tertiary)">
            {points[points.length - 1].date}
          </text>
        )}
      </svg>
      <div className="flex gap-4 text-[10px] text-[var(--wz-text-tertiary)] mt-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-px bg-[var(--wz-gold)]" /> Called
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-px bg-[var(--wz-positive)]" /> Distributed
        </span>
      </div>
    </div>
  );
}

export default function FundDashboard() {
  const { funds, fundId, activeFund, loading: fundsLoading, reloadFunds } = useFundContext(true);
  const [data, setData] = useState(null);
  const [commitments, setCommitments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newFund, setNewFund] = useState(false);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new
  const [timeline, setTimeline] = useState(null);
  const [capKind, setCapKind] = useState(null); // "call" | "distribution" | null

  const load = useCallback(async () => {
    if (!fundId) { setData(null); setCommitments([]); setTimeline(null); return; }
    setLoading(true);
    try {
      const [d, c, tl] = await Promise.all([
        api.get(`/funds/${fundId}/dashboard`),
        api.get(`/funds/${fundId}/commitments`),
        // capital.read is a separate permission from funds.read, so a role
        // that can see the fund but not its cash flows still gets a page.
        api.get(`/funds/${fundId}/capital-timeline`).catch(() => null),
      ]);
      setData(d.data);
      setCommitments(c.data || []);
      setTimeline(tl?.data || null);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not load the fund");
    } finally { setLoading(false); }
  }, [fundId]);

  useEffect(() => { load(); }, [load]);

  const removeEvent = async (ev) => {
    if (!window.confirm(`Remove this ${ev.kind === "call" ? "capital call" : "distribution"}? Every LP balance it affected will be recalculated.`)) return;
    try {
      await api.delete(`/funds/${fundId}/capital-events/${ev.id}`);
      toast.success("Removed");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not remove");
    }
  };

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

          {/* DPI needs no valuation — only distributions over paid-in capital —
              so unlike TVPI and net IRR it is a real number from Phase 3 on. */}
          {data.dpi != null && (
            <div className="wz-grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 mb-6">
              <Tile testid="tile-dpi" label="DPI" value={`${data.dpi.toFixed(2)}x`}
                    sub="Distributed over paid-in" />
            </div>
          )}

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
                    {" — these need portfolio valuations, which arrive with holdings. "}
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

          {timeline && (
            <div className="wz-card p-0 overflow-hidden mt-6" data-testid="capital-activity">
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--wz-border)]">
                <div className="overline">Capital activity</div>
                <div className="ml-auto flex gap-1">
                  <button data-testid="cap-add-call" className="wz-btn wz-btn-ghost text-[11px] flex items-center gap-1"
                          onClick={() => setCapKind("call")}>
                    <ArrowDown size={12} /> Record call
                  </button>
                  <button data-testid="cap-add-dist" className="wz-btn wz-btn-ghost text-[11px] flex items-center gap-1"
                          onClick={() => setCapKind("distribution")}>
                    <ArrowUp size={12} /> Record distribution
                  </button>
                </div>
              </div>

              {timeline.points.length === 0 ? (
                <div className="px-4 py-8 text-center text-[var(--wz-text-tertiary)] text-xs">
                  No capital calls or distributions recorded yet. Paid-in and distributed
                  capital are derived from these, so both stay at zero until the first call.
                </div>
              ) : (
                <>
                  <div className="px-4 pt-4">
                    <CapitalChart points={timeline.points} committed={timeline.committed} currency={cur} />
                  </div>
                  <table className="w-full text-xs mt-2">
                    <thead>
                      <tr className="text-left">
                        <th className="overline px-4 py-2">Date</th>
                        <th className="overline px-4 py-2">Event</th>
                        <th className="overline px-4 py-2 text-right">Amount</th>
                        <th className="overline px-4 py-2 text-right">Cumulative called</th>
                        <th className="overline px-4 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {[...timeline.points].reverse().map((p) => (
                        <tr key={p.id} data-testid={`cap-row-${p.id}`} className="border-t border-[var(--wz-border)]">
                          <td className="px-4 py-2.5 font-mono-wz">{p.date}</td>
                          <td className="px-4 py-2.5">
                            <span className={`pill ${p.kind === "call" ? "" : "pill-gold"} mr-2`}>
                              {p.kind === "call" ? "Call" : "Distribution"}
                            </span>
                            {p.label}
                            {p.is_opening && (
                              <span className="text-[10px] text-[var(--wz-text-tertiary)] ml-1">
                                · carried over from figures entered before capital tracking
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono-wz">{money(p.amount, cur)}</td>
                          <td className="px-4 py-2.5 text-right font-mono-wz text-[var(--wz-text-secondary)]">
                            {money(p.cumulative_called, cur)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button className="wz-btn wz-btn-ghost text-[11px] text-[var(--wz-negative)]"
                                    onClick={() => removeEvent(p)} title="Remove">
                              <Trash size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}

          <div className="text-[11px] text-[var(--wz-text-tertiary)] mt-4">
            All figures are computed from recorded commitments and capital activity.
            Values are unaudited and subject to change.
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
      {capKind && fundId && (
        <CapitalEventModal fundId={fundId} kind={capKind}
                           onClose={() => setCapKind(null)}
                           onSaved={() => { setCapKind(null); load(); }} />
      )}
    </div>
  );
}
