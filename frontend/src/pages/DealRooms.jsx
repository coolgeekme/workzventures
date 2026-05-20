import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { FileText, Files, MagnifyingGlass, ListChecks, ArrowUpRight } from "@phosphor-icons/react";

export default function DealRooms() {
  const { user } = useAuth();
  const [rooms, setRooms] = useState([]);
  const isSeller = user?.role === "seller";

  useEffect(() => {
    api.get("/deal-rooms").then((r) => setRooms(r.data));
  }, []);

  return (
    <div data-testid="deal-rooms-page" className="px-8 py-8">
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
              <span className={`pill ${r.status === "active" ? "pill-positive" : r.status === "closed" ? "pill-gold" : "pill-amber"}`}>
                {r.status.replace("_", " ")}
              </span>
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
          <div className="wz-card p-10 text-center text-sm text-[var(--wz-text-tertiary)] lg:col-span-2">
            <FileText size={28} className="mx-auto mb-3 text-[var(--wz-text-tertiary)]" />
            {isSeller ? (
              <>No vaults yet. Open one from an engaged inquiry on the <Link to="/app/inquiries" className="text-[var(--wz-amber)] hover:underline">Inquiries page</Link>.</>
            ) : (
              <>No vaults yet. Sellers open these when they engage with your inquiry.</>
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
