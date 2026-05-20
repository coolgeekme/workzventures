import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function Audit() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    api.get("/audit/logs").then((r) => setLogs(r.data));
  }, []);

  return (
    <div data-testid="audit-page" className="px-8 py-8">
      <div className="overline mb-3">Audit log</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        Full auditability across the platform.
      </h1>

      <div className="wz-card mt-8 overflow-hidden">
        <table className="w-full font-mono-wz text-xs">
          <thead>
            <tr className="text-[var(--wz-text-tertiary)] border-b border-[var(--wz-border)]">
              <th className="text-left overline py-3 px-5">Timestamp</th>
              <th className="text-left overline">Actor</th>
              <th className="text-left overline">Action</th>
              <th className="text-left overline">Target</th>
              <th className="text-left overline pr-5">Meta</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-[var(--wz-border)] hover:bg-[var(--wz-surface-hover)]">
                <td className="px-5 py-2 text-[var(--wz-text-secondary)]">{new Date(l.timestamp).toLocaleString()}</td>
                <td className="text-[var(--wz-gold)]">{(l.actor_id || "").substring(0, 8)}</td>
                <td className="text-white">{l.action}</td>
                <td className="text-[var(--wz-text-secondary)]">{l.target}</td>
                <td className="pr-5 text-[var(--wz-text-tertiary)] truncate max-w-xs">{JSON.stringify(l.meta || {})}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan="5" className="text-center text-[var(--wz-text-tertiary)] py-12">No audit entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
