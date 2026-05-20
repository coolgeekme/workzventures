import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { LinkedinLogo, Trash, Plugs } from "@phosphor-icons/react";

export default function Composio() {
  const [status, setStatus] = useState(null);
  const [connections, setConnections] = useState([]);
  const [connecting, setConnecting] = useState(false);

  const load = () => Promise.all([
    api.get("/composio/status").then((r) => setStatus(r.data)),
    api.get("/composio/connections").then((r) => setConnections(r.data.connections || [])),
  ]);

  useEffect(() => { load(); }, []);

  const connectLinkedIn = async () => {
    setConnecting(true);
    try {
      const r = await api.post("/composio/connect/linkedin");
      toast.success("LinkedIn connection initiated via Composio");
      if (r.data.redirect_url) {
        window.open(r.data.redirect_url, "_blank", "noopener");
      }
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    } finally {
      setConnecting(false);
    }
  };

  const remove = async (id) => {
    await api.delete(`/composio/connections/${id}`);
    toast.success("Disconnected");
    load();
  };

  return (
    <div data-testid="composio-page" className="px-8 py-8">
      <div className="overline mb-3">Composio gateway</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        OAuth connectors for every professional network.
      </h1>

      <div className="wz-card p-6 mt-8 flex items-start justify-between flex-wrap gap-4" data-testid="composio-status">
        <div>
          <div className="overline mb-2">Gateway</div>
          <div className="font-mono-wz text-sm">{status?.gateway || "—"}</div>
          <div className="overline mt-4 mb-2">Status</div>
          <span className={`pill ${status?.configured ? "pill-positive" : "pill-negative"}`}>
            {status?.configured ? "configured" : "missing key"}
          </span>
        </div>
        <div>
          <div className="overline mb-2">Supported apps</div>
          <div className="flex flex-wrap gap-2">
            {(status?.supported_apps || []).map((a) => (
              <span key={a} className="pill pill-gold">{a}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <div className="wz-card p-6" data-mcp-action="composio.linkedin.connect">
          <LinkedinLogo size={28} className="text-[var(--wz-gold)]" />
          <div className="font-display text-xl tracking-tight mt-4">LinkedIn</div>
          <p className="text-sm text-[var(--wz-text-secondary)] mt-1">
            Connect your LinkedIn account to enable AI agents to publish outreach posts and DMs from the Workz platform.
          </p>
          <button
            onClick={connectLinkedIn}
            disabled={connecting}
            data-testid="connect-linkedin"
            className="wz-btn wz-btn-gold mt-5 flex items-center gap-2"
          >
            <Plugs size={14} /> {connecting ? "Connecting…" : "Connect via Composio"}
          </button>
        </div>

        <div className="wz-card p-6">
          <div className="overline mb-3">Active connections</div>
          {connections.length === 0 && (
            <div className="text-sm text-[var(--wz-text-tertiary)]">No connections yet.</div>
          )}
          <div className="space-y-3" data-testid="connection-list">
            {connections.map((c) => (
              <div key={c.id} className="flex items-center justify-between border border-[var(--wz-border)] px-3 py-3">
                <div>
                  <div className="font-mono-wz text-xs uppercase tracking-widest text-[var(--wz-gold)]">{c.app}</div>
                  <div className="text-xs text-[var(--wz-text-secondary)] mt-1">{c.entity_id}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`pill ${c.status === "active" ? "pill-positive" : "pill-amber"}`}>{c.status}</span>
                  <button onClick={() => remove(c.id)} className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-negative)] transition-colors" data-testid={`disconnect-${c.id}`}>
                    <Trash size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
