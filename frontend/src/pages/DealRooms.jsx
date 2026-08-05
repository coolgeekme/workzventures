import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAgentMode } from "../lib/agentMode";
import { FileText, Files, MagnifyingGlass, ListChecks, ArrowUpRight, Trash, FolderOpen } from "@phosphor-icons/react";

export default function DealRooms() {
  const { user } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [agentMode] = useAgentMode();
  // Sellers AND agents-in-seller-mode get the sell-side empty-state copy.
  const isSeller =
    user?.role === "seller" || (user?.role === "agent" && agentMode === "seller");

  const load = () => api.get("/deal-rooms").then((r) => setRooms(r.data));
  useEffect(() => { load(); }, []);

  const remove = async (e, r) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Close & archive the Vault for "${r.listing_name}"? Proofs and audit logs are preserved.`)) return;
    try {
      await api.delete(`/deal-rooms/${r.id}`);
      toast.success("Vault archived");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <div data-testid="deal-rooms-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="overline mb-3" style={{ color: isSeller ? "var(--wz-amber)" : "var(--wz-gold)" }}>
        The Vault
      </div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium">
        {isSeller ? "Active diligence with engaged buyers." : "Your active diligence workspaces."}
      </h1>
      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
        NDA-gated, Co-pilot-assisted workspaces opened against engaged inquiries. Upload files, work the DRL, ask the Co-pilot, generate findings with citations — all in one place.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8" data-testid="rooms-grid">
        {rooms.map((r) => (
          <Link
            key={r.id}
            to={`/app/rooms/${r.id}`}
            data-testid={`room-card-${r.id}`}
            className="wz-card p-6 hover:border-[var(--wz-text-tertiary)] transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="overline mb-1">{r.sector || "—"}</div>
                <div className="font-display text-xl tracking-tight">{r.listing_name}</div>
                <div className="text-xs text-[var(--wz-text-secondary)] mt-1 truncate">
                  {isSeller ? `buyer · ${r.buyer_name} (${r.buyer_org})` : `seller · ${r.seller_name} (${r.seller_org})`}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className={`pill ${r.status === "active" ? "pill-positive" : r.status === "closed" ? "pill-gold" : "pill-amber"}`}>
                  {r.status.replace("_", " ")}
                </span>
                {r.is_preview && (
                  <span
                    className="pill"
                    style={{ borderColor: "var(--wz-gold)", color: "var(--wz-gold)" }}
                    data-testid={`preview-badge-${r.id}`}
                    title="Preview Vault — created by the sell-side workspace to QA buyer flow"
                  >
                    preview
                  </span>
                )}
              </div>
              <button
                onClick={(e) => remove(e, r)}
                data-testid={`delete-room-${r.id}`}
                title="Close vault"
                className="p-1 text-[var(--wz-text-tertiary)] hover:text-[var(--wz-negative)]"
              >
                <Trash size={13} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-5">
              <Tile icon={Files} label="files" value={r.files_count} />
              <Tile icon={ListChecks} label="DRL items" value={r.requests_count} />
              <Tile icon={MagnifyingGlass} label="findings" value={r.findings_count} />
            </div>

            <div className="mt-5 pt-3 border-t border-[var(--wz-border)] flex items-center justify-between text-xs">
              <span className="font-mono-wz text-[var(--wz-text-tertiary)]">
                opened {new Date(r.created_at).toLocaleDateString()}
              </span>
              <span className={`flex items-center gap-1 ${isSeller ? "text-[var(--wz-amber)]" : "text-[var(--wz-gold)]"}`}>
                Open <ArrowUpRight size={12} />
              </span>
            </div>
          </Link>
        ))}
        {rooms.length === 0 && (
          <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)] lg:col-span-2" data-testid="vault-empty-state">
            <FileText size={28} className="mx-auto mb-3 text-[var(--wz-text-tertiary)]" />
            {isSeller ? (
              <>
                <div className="text-[var(--wz-text)] font-medium mb-2">No active Vaults yet</div>
                <p className="leading-relaxed max-w-xl mx-auto">
                  A Vault opens when you mark a buyer&apos;s inquiry as{" "}
                  <span className="text-[var(--wz-positive)] font-medium">Accepted</span> on the{" "}
                  <Link to="/app/inquiries" className="text-[var(--wz-gold)] hover:underline">Inquiries page</Link>
                  {" "}and click <span className="font-medium">Open Vault</span>.
                </p>
                <p className="leading-relaxed max-w-xl mx-auto mt-3">
                  Want to <strong>pre-stage documents</strong> now so they&apos;re ready the moment a
                  buyer engages? Use the <span className="font-medium">Deal Data Room</span> on
                  each of your deals — staged docs auto-clone into every Vault you open.
                </p>
                <Link
                  to="/app/listings"
                  className="wz-btn wz-btn-gold mt-5 inline-flex items-center gap-2"
                  data-testid="vault-empty-goto-listings"
                >
                  <FolderOpen size={14} /> Open Deal Data Room
                </Link>
              </>
            ) : (
              <>
                <div className="text-[var(--wz-text)] font-medium mb-2">No Vaults yet</div>
                <p className="leading-relaxed max-w-xl mx-auto">
                  A Vault opens after the seller marks your inquiry{" "}
                  <span className="text-[var(--wz-positive)] font-medium">Accepted</span> on the{" "}
                  <Link to="/app/inquiries" className="text-[var(--wz-gold)] hover:underline">Inquiries page</Link>
                  {" "}and opens it for you. If your inquiry shows{" "}
                  <span className="text-[var(--wz-negative)] font-medium">Declined</span>, the seller passed —
                  no Vault will open for that deal.
                </p>
                <Link
                  to="/app/marketplace"
                  className="wz-btn wz-btn-gold mt-5 inline-flex items-center gap-2"
                  data-testid="vault-empty-goto-marketplace"
                >
                  Browse marketplace
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, value }) {
  return (
    <div className="border border-[var(--wz-border)] p-3 text-center">
      <Icon size={14} className="mx-auto text-[var(--wz-text-tertiary)]" />
      <div className="font-mono-wz text-lg mt-1">{value}</div>
      <div className="overline">{label}</div>
    </div>
  );
}
