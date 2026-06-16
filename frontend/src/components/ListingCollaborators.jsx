import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserPlus, Trash, ShieldCheck, Warning } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

/**
 * Inline panel for managing collaborators on a listing. Render inside the
 * listing detail page (e.g. MyListings detail modal). Props:
 *   - listingId: required, the listing id
 *   - sellerId: the principal owner's user id (used for permission hints)
 *   - currentAccessPolicy: { require_principal_approval, competitor_blocklist }
 *   - onChange: optional callback fired after a successful mutation
 */
export default function ListingCollaborators({ listingId, sellerId, currentAccessPolicy, onChange }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [inviteMessage, setInviteMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState({
    require_principal_approval: currentAccessPolicy?.require_principal_approval || false,
    competitor_blocklist_text: (currentAccessPolicy?.competitor_blocklist || []).join("\n"),
  });

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/listings/${listingId}/collaborators`);
      setData(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load collaborators");
    }
    setLoading(false);
  };

  useEffect(() => { if (listingId) load(); }, [listingId]); // eslint-disable-line

  const invite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setBusy(true);
    try {
      const r = await api.post(`/listings/${listingId}/collaborators`, {
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        message: inviteMessage.trim() || undefined,
      });
      toast.success(`Invite sent to ${inviteEmail}`);
      if (r.data?.accept_url && navigator.clipboard) {
        navigator.clipboard.writeText(r.data.accept_url).catch(() => {});
      }
      setInviteEmail(""); setInviteMessage("");
      await load();
      onChange?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Invite failed");
    }
    setBusy(false);
  };

  const remove = async (userId, name) => {
    if (!window.confirm(`Remove ${name || "this collaborator"} from the listing?`)) return;
    try {
      await api.delete(`/listings/${listingId}/collaborators/${userId}`);
      toast.success("Removed");
      await load();
      onChange?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Remove failed");
    }
  };

  const savePolicy = async () => {
    setBusy(true);
    try {
      const blocklist = policy.competitor_blocklist_text
        .split("\n").map((s) => s.trim()).filter(Boolean);
      const r = await api.patch(`/listings/${listingId}/access-policy`, {
        require_principal_approval: policy.require_principal_approval,
        competitor_blocklist: blocklist,
      });
      toast.success("Access policy updated");
      onChange?.(r.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    }
    setBusy(false);
  };

  if (loading) return <div className="text-xs text-[var(--wz-text-tertiary)]" data-testid="listing-collaborators-loading">Loading collaborators…</div>;
  if (!data) return null;

  const isPrincipal = sellerId === user?.id;

  return (
    <div className="space-y-6" data-testid="listing-collaborators">
      <div>
        <div className="overline mb-3">Current collaborators</div>
        {(data.collaborators || []).length === 0 ? (
          <div className="text-xs text-[var(--wz-text-tertiary)]">
            Just the principal owner so far. Invite the seller / advisor below.
          </div>
        ) : (
          <div className="border border-[var(--wz-border)] divide-y divide-[var(--wz-border)]">
            {data.collaborators.map((c) => (
              <div key={c.user_id} data-testid={`collab-${c.user_id}`} className="flex items-center justify-between p-3">
                <div>
                  <div className="text-sm font-medium">{c.name || c.email}</div>
                  <div className="text-xs text-[var(--wz-text-tertiary)]">
                    {c.email} · {c.role}
                  </div>
                </div>
                <button
                  data-testid={`collab-remove-${c.user_id}`}
                  onClick={() => remove(c.user_id, c.name)}
                  className="text-xs text-[var(--wz-danger)] hover:underline flex items-center gap-1"
                >
                  <Trash size={12} /> Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {(data.pending_invites || []).length > 0 && (
        <div>
          <div className="overline mb-3">Pending invites · {data.pending_invites.length}</div>
          <div className="border border-[var(--wz-border)] divide-y divide-[var(--wz-border)]">
            {data.pending_invites.map((iv) => (
              <div key={iv.id} className="p-3" data-testid={`collab-pending-${iv.id}`}>
                <div className="text-sm">{iv.email}</div>
                <div className="text-xs text-[var(--wz-text-tertiary)]">
                  {iv.role} · expires {new Date(iv.expires_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={invite} className="space-y-3" data-testid="collab-invite-form">
        <div className="overline">Invite a collaborator</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            data-testid="collab-invite-email"
            required type="email"
            placeholder="seller@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="wz-input sm:col-span-2"
          />
          <select
            data-testid="collab-invite-role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="wz-input"
          >
            <option value="owner">Owner (principal)</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <textarea
          data-testid="collab-invite-message"
          placeholder="Optional note (sent in the invite email)"
          value={inviteMessage}
          onChange={(e) => setInviteMessage(e.target.value)}
          rows={2}
          className="wz-input"
        />
        <button data-testid="collab-invite-submit" type="submit" disabled={busy} className="wz-btn wz-btn-gold inline-flex items-center gap-2">
          <UserPlus size={14} /> {busy ? "Sending…" : "Send invitation"}
        </button>
      </form>

      <div className="border-t border-[var(--wz-border)] pt-5">
        <div className="overline mb-3 flex items-center gap-2">
          <ShieldCheck size={14} className="text-[var(--wz-gold)]" /> Vault access policy
        </div>
        <p className="text-xs text-[var(--wz-text-secondary)] mb-4 leading-relaxed">
          By default the agent (editor) approves Vault access requests.
          Flip <strong>"Require principal approval"</strong> to demand sign-off from the principal
          owner before any buyer is granted Vault access. The competitor blocklist
          auto-escalates buyer requests matching any of these to the principal regardless.
        </p>
        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input
            data-testid="policy-require-principal"
            type="checkbox"
            checked={policy.require_principal_approval}
            onChange={(e) => setPolicy({ ...policy, require_principal_approval: e.target.checked })}
          />
          <span className="text-sm">Require principal approval for every Vault grant</span>
        </label>
        <label className="block">
          <div className="overline mb-2">Competitor blocklist (one per line)</div>
          <textarea
            data-testid="policy-blocklist"
            value={policy.competitor_blocklist_text}
            onChange={(e) => setPolicy({ ...policy, competitor_blocklist_text: e.target.value })}
            rows={4}
            className="wz-input font-mono-wz text-xs"
            placeholder={"competitor1.com\nBig Competitor LLC\nformer-employee@gmail.com"}
          />
        </label>
        <div className="flex items-start gap-2 mt-2 text-[11px] text-[var(--wz-text-tertiary)]">
          <Warning size={12} className="shrink-0 mt-0.5" />
          <span>Buyer requests matching any line — by domain, name or email — escalate to the principal.</span>
        </div>
        <button
          data-testid="policy-save"
          onClick={savePolicy}
          disabled={busy}
          className="wz-btn wz-btn-ghost mt-4 text-xs"
        >
          {busy ? "Saving…" : "Save access policy"}
        </button>
      </div>
    </div>
  );
}
