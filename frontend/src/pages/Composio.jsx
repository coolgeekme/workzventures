import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { LinkedinLogo, Trash, Plugs, Buildings } from "@phosphor-icons/react";

const APPS = [
  {
    id: "linkedin",
    name: "LinkedIn",
    description: "Connect your LinkedIn account so AI agents can publish outreach posts and DMs from the Workz platform.",
    icon: LinkedinLogo,
    connectPath: "/composio/connect/linkedin",
    iconColor: "var(--wz-gold)",
  },
  {
    id: "zoho_crm",
    name: "Zoho CRM",
    description: "Sync buyer inquiries, contacts, and the lead-nurturing pipeline into Zoho CRM (US data center).",
    icon: Buildings,
    connectPath: "/composio/connect/zoho-crm",
    iconColor: "var(--wz-amber)",
  },
];

export default function Composio() {
  const [status, setStatus] = useState(null);
  const [connections, setConnections] = useState([]);
  const [connecting, setConnecting] = useState(null);

  const load = () => Promise.all([
    api.get("/composio/status").then((r) => setStatus(r.data)),
    api.get("/composio/connections").then((r) => setConnections(r.data.connections || [])),
  ]);

  useEffect(() => { load(); }, []);

  const connect = async (app) => {
    setConnecting(app.id);
    try {
      const r = await api.post(app.connectPath);
      toast.success(`${app.name} connection initiated`);
      if (r.data.redirect_url) {
        window.open(r.data.redirect_url, "_blank", "noopener");
      }
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    } finally {
      setConnecting(null);
    }
  };

  const remove = async (id) => {
    await api.delete(`/composio/connections/${id}`);
    toast.success("Disconnected");
    load();
  };

  const isConnected = (appId) => connections.some((c) => c.app === appId);

  return (
    <div data-testid="composio-page" className="px-8 py-8">
      <div className="overline mb-3">Integrations</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        OAuth connectors for every professional network.
      </h1>

      <div className="wz-card p-6 mt-8 flex items-start justify-between flex-wrap gap-4" data-testid="composio-status">
        <div>
          <div className="overline mb-2">Gateway</div>
          <div className="font-mono-wz text-sm">connected</div>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6" data-testid="connector-grid">
        {APPS.map((app) => {
          const Icon = app.icon;
          const connected = isConnected(app.id);
          return (
            <div key={app.id} className="wz-card p-6" data-testid={`connector-${app.id}`}>
              <div className="flex items-start justify-between">
                <Icon size={28} style={{ color: app.iconColor }} />
                {connected && <span className="pill pill-positive">connected</span>}
              </div>
              <div className="font-display text-xl tracking-tight mt-4">{app.name}</div>
              <p className="text-sm text-[var(--wz-text-secondary)] mt-1 min-h-[48px]">
                {app.description}
              </p>
              <button
                onClick={() => connect(app)}
                disabled={connecting === app.id}
                data-testid={`connect-${app.id}`}
                className={`mt-5 flex items-center gap-2 wz-btn ${connected ? "wz-btn-ghost" : "wz-btn-gold"}`}
              >
                <Plugs size={14} />
                {connecting === app.id ? "Connecting…" : connected ? "Reconnect" : `Connect ${app.name}`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="wz-card mt-8" data-testid="connection-list">
        <div className="border-b border-[var(--wz-border)] px-6 py-4">
          <div className="overline">Active connections</div>
          <div className="font-display text-lg tracking-tight mt-1">All linked accounts</div>
        </div>
        {connections.length === 0 && (
          <div className="px-6 py-10 text-center text-sm text-[var(--wz-text-tertiary)]">
            No connections yet. Connect an app above to get started.
          </div>
        )}
        <div className="divide-y divide-[var(--wz-border)]">
          {connections.map((c) => (
            <div key={c.id} className="px-6 py-4 flex items-center justify-between">
              <div>
                <div className="font-mono-wz text-xs uppercase tracking-widest text-[var(--wz-gold)]">{c.app}{c.region ? ` · ${c.region}` : ""}</div>
                <div className="text-xs text-[var(--wz-text-secondary)] mt-1">{c.entity_id}</div>
                <div className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] mt-1">
                  {new Date(c.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`pill ${c.status === "active" ? "pill-positive" : "pill-amber"}`}>{c.status}</span>
                {c.redirect_url && c.status !== "active" && (
                  <a
                    href={c.redirect_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-mono-wz uppercase tracking-widest border border-[var(--wz-border)] px-3 py-1 hover:border-[var(--wz-gold)] hover:text-[var(--wz-gold)]"
                    data-testid={`resume-${c.id}`}
                  >
                    Resume OAuth
                  </a>
                )}
                <button
                  onClick={() => remove(c.id)}
                  className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-negative)] transition-colors"
                  data-testid={`disconnect-${c.id}`}
                >
                  <Trash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
