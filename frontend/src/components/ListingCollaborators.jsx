import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserPlus, Trash, ShieldCheck, Warning, ArrowsClockwise, X } from "@phosphor-icons/react";
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
export default function ListingCollaborators({ listingId, sellerId, currentAccessPolicy, onChange, readOnly = false }) {
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

  const changeRole = async (userId, newRole) => {
    try {
      await api.patch(`/listings/${listingId}/collaborators/${userId}`, { role: newRole });
      toast.success(`Role updated to ${newRole}`);
      await load();
      onChange?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Role update failed");
      await load(); // reload so the dropdown snaps back to the actual server value
    }
  };

  const revokeInvite = async (inviteId, email) => {
    if (!window.confirm(`Cancel the pending invite to ${email}? The link in their email will stop working.`)) return;
    try {
      await api.delete(`/listings/${listingId}/collaborators/invites/${inviteId}`);
      toast.success("Invite cancelled");
      await load();
      onChange?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Cancel failed");
      await load(); // refresh to reflect server truth if the row was already gone
    }
  };

  const [resendingId, setResendingId] = useState(null);
  const resendInvite = async (inviteId, email) => {
    setResendingId(inviteId);
    try {
      await api.post(`/listings/${listingId}/collaborators/${inviteId}/resend`);
      toast.success(`Invite re-sent to ${email}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Resend failed");
    } finally {
      setResendingId(null);
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
    <div className="space-y-6" data-testid="listing-collaborators" data-read-only={readOnly}>
      {readOnly && (
        <div className="text-[11px] text-[var(--wz-gold)] border border-[var(--wz-gold)]/40 bg-[var(--wz-gold)]/5 px-3 py-2" data-testid="collab-readonly-notice">
          Read-only · advisor management controls are hidden in principal preview.
        </div>
      )}
      <div>
        <div className="overline mb-3">Current collaborators</div>
        {(data.collaborators || []).length === 0 ? (
          <div className="text-xs text-[var(--wz-text-tertiary)]">
            Just the principal owner so far. Invite the seller / advisor below.
          </div>
        ) : (
          <div className="border border-[var(--wz-border)] divide-y divide-[var(--wz-border)]">
            {data.collaborators.map((c) => {
              const isOwner = c.user_id === sellerId;
              // Server tells us whether the current viewer can manage this row
              // (Rule 1B: principal owner OR original inviter only).
              const canEdit = !readOnly && !isOwner && c.can_manage;
              return (
                <div key={c.user_id} data-testid={`collab-${c.user_id}`} className="flex items-center justify-between p-3 gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{c.name || c.email}</div>
                    <div className="text-xs text-[var(--wz-text-tertiary)] truncate">
                      {c.email}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isOwner ? (
                      <span className="text-[10px] font-mono-wz uppercase tracking-widest text-[var(--wz-gold)] border border-[var(--wz-gold)]/40 px-2 py-1">
                        {c.role || "owner"} · principal
                      </span>
                    ) : canEdit ? (
                      <select
                        data-testid={`collab-role-${c.user_id}`}
                        value={c.role || "viewer"}
                        onChange={(e) => changeRole(c.user_id, e.target.value)}
                        className="wz-input text-xs py-1 px-2"
                        style={{ minWidth: "100px" }}
                        title="Change collaborator role"
                      >
                        <option value="owner">Owner</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <span className="text-xs text-[var(--wz-text-tertiary)]" title={!isOwner && !readOnly ? "Only the principal or the person who invited this collaborator can change their role" : undefined}>{c.role}</span>
                    )}
                    {canEdit && (
                      <button
                        data-testid={`collab-remove-${c.user_id}`}
                        onClick={() => remove(c.user_id, c.name)}
                        className="text-xs text-[var(--wz-danger)] hover:underline flex items-center gap-1"
                        title="Remove from deal"
                      >
                        <Trash size={12} /> Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(data.pending_invites || []).length > 0 && (
        <div>
          <div className="overline mb-3">Pending invites · {data.pending_invites.length}</div>
          <div className="border border-[var(--wz-border)] divide-y divide-[var(--wz-border)]">
            {data.pending_invites.map((iv) => (
              <div key={iv.id} className="p-3 flex items-center justify-between gap-3" data-testid={`collab-pending-${iv.id}`}>
                <div className="min-w-0">
                  <div className="text-sm truncate">{iv.email}</div>
                  <div className="text-xs text-[var(--wz-text-tertiary)]">
                    {iv.role} · expires {new Date(iv.expires_at).toLocaleDateString()}
                  </div>
                </div>
                {!readOnly && iv.can_manage && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => resendInvite(iv.id, iv.email)}
                      disabled={resendingId === iv.id}
                      data-testid={`collab-invite-resend-${iv.id}`}
                      className="text-xs text-[var(--wz-text-secondary)] hover:text-[var(--wz-gold)] flex items-center gap-1 disabled:opacity-50"
                      title="Email the invite again"
                    >
                      <ArrowsClockwise size={12} /> {resendingId === iv.id ? "Sending…" : "Resend"}
                    </button>
                    <button
                      onClick={() => revokeInvite(iv.id, iv.email)}
                      data-testid={`collab-invite-revoke-${iv.id}`}
                      className="text-xs text-[var(--wz-danger)] hover:underline flex items-center gap-1"
                      title="Cancel this pending invite"
                    >
                      <X size={12} /> Cancel
                    </button>
                  </div>
                )}
                {!readOnly && !iv.can_manage && (
                  <span className="text-[10px] font-mono-wz uppercase tracking-widest text-[var(--wz-text-tertiary)]" title="Only the principal or the user who sent this invite can resend or cancel it">
                    locked
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!readOnly && (
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
      )}

      <div className="border-t border-[var(--wz-border)] pt-5">
        <div className="overline mb-3 flex items-center gap-2">
          <ShieldCheck size={14} className="text-[var(--wz-gold)]" /> Vault access policy
        </div>
        <p className="text-xs text-[var(--wz-text-secondary)] mb-4 leading-relaxed">
          By default the advisor (editor) approves Vault access requests.
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
          disabled={busy || readOnly}
          className="wz-btn wz-btn-ghost mt-4 text-xs"
          style={readOnly ? { display: "none" } : undefined}
        >
          {busy ? "Saving…" : "Save access policy"}
        </button>
      </div>
    </div>
  );
}
