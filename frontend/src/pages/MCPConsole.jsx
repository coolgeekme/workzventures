import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { listLocalActions } from "../lib/mcp";
import { toast } from "sonner";
import { Terminal, Lightning } from "@phosphor-icons/react";

export default function MCPConsole() {
  const [serverActions, setServerActions] = useState([]);
  const [clientActions, setClientActions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [paramsText, setParamsText] = useState("{}");
  const [out, setOut] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api.get("/mcp/actions").then((r) => setServerActions(r.data.actions));
    setClientActions(listLocalActions());
  }, []);

  const invoke = async () => {
    if (!selected) return;
    setRunning(true);
    setOut("");
    try {
      const params = JSON.parse(paramsText || "{}");
      const data = await navigator.mcpActions.invoke(selected.id, params);
      setOut(JSON.stringify(data, null, 2));
      toast.success(`Invoked ${selected.id}`);
    } catch (err) {
      setOut(String(err?.message || err));
      toast.error(err?.message || "Invoke failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div data-testid="mcp-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="overline mb-3">WebMCP console</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium flex items-center gap-3">
        <Terminal size={28} className="text-[var(--wz-gold)]" />
        MCP Actions surface
      </h1>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-3 max-w-2xl">
        Every workflow on Workz is registered as a WebMCP action via <code className="font-mono-wz text-[var(--wz-gold)]">data-mcp-action</code> attributes and <code className="font-mono-wz text-[var(--wz-gold)]">navigator.mcpActions.register()</code>. AI browsing agents (such as LangChain, Hermes, and chrome-based assistants) discover and invoke them directly.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6 mt-8">
        <div className="wz-card" data-testid="actions-list">
          <div className="border-b border-[var(--wz-border)] px-5 py-3 flex items-center justify-between">
            <div className="overline">Registered actions</div>
            <span className="font-mono-wz text-xs text-[var(--wz-text-secondary)]">{serverActions.length} declared · {clientActions.length} bound</span>
          </div>
          <div className="divide-y divide-[var(--wz-border)] font-mono-wz text-xs">
            {serverActions.map((a) => (
              <button
                key={a.id}
                onClick={() => { setSelected(a); setParamsText(JSON.stringify(buildSampleParams(a), null, 2)); }}
                className={`w-full text-left px-5 py-3 hover:bg-[var(--wz-surface-hover)] transition-colors ${selected?.id === a.id ? "bg-[var(--wz-surface-hover)]" : ""}`}
                data-testid={`mcp-action-${a.id}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[var(--wz-gold)]">{a.id}</span>
                  <span className={`pill ${a.type === "imperative" ? "pill-amber" : "pill-gold"}`}>{a.type}</span>
                </div>
                <div className="mt-1 text-[var(--wz-text-secondary)] normal-case font-sans">{a.description}</div>
                <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--wz-text-tertiary)]">
                  <span>{a.method}</span>
                  <span>{a.endpoint}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="wz-card flex flex-col" data-testid="invoker">
          <div className="border-b border-[var(--wz-border)] px-5 py-3 flex items-center justify-between">
            <div className="overline flex items-center gap-2"><Lightning size={12} /> invoker</div>
            <span className="font-mono-wz text-[10px] text-[var(--wz-text-tertiary)]">navigator.mcpActions.invoke()</span>
          </div>
          <div className="p-5 flex-1">
            <div className="overline mb-2">Action</div>
            <div className="font-mono-wz text-sm text-[var(--wz-gold)] mb-4">{selected?.id || "— select an action —"}</div>

            <div className="overline mb-2">Params (JSON)</div>
            <textarea
              data-testid="mcp-params"
              rows={8}
              className="wz-input font-mono-wz text-xs"
              value={paramsText}
              onChange={(e) => setParamsText(e.target.value)}
              disabled={!selected}
            />

            <button
              data-testid="mcp-invoke"
              onClick={invoke}
              disabled={!selected || running}
              className="wz-btn wz-btn-gold w-full mt-4"
            >
              {running ? "Invoking…" : "Invoke"}
            </button>

            <div className="overline mt-5 mb-2">Output</div>
            <pre data-testid="mcp-output" className="bg-[var(--wz-bg)] border border-[var(--wz-border)] p-3 font-mono-wz text-[11px] text-[var(--wz-text-secondary)] overflow-auto max-h-72">{out || "—"}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildSampleParams(a) {
  switch (a.id) {
    case "research.company.summarize": return { company_name: "Anthropic", sector: "AI", region: "NA" };
    case "collateral.generate": return { asset_type: "one_pager", deal_name: "Project Helios", target_audience: "Strategic industrial buyers", key_points: "Rev $312M, EBITDA $84M, dominant in DACH" };
    case "outreach.campaign.create": return { name: "Q1 Demo Campaign", target_persona: "CIOs at industrial buyers", channel: "linkedin", message_brief: "Position Helios as a category-leading consolidation target" };
    case "leads.list": return {};
    case "leads.advance": return { lead_id: "<lead-id>", stage: "qualified" };
    case "newsletter.draft": return { topic: "this week's deal flow" };
    case "newsletter.dispatch": return { id: "<newsletter-id>" };
    case "composio.linkedin.connect": return {};
    case "dashboard.kpis": return {};
    default: return {};
  }
}
