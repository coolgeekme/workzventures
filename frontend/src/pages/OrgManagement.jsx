import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Buildings, UserPlus, Trash, ArrowsClockwise, Plus, Copy } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import Layout from "../components/Layout";

export default function OrgManagement() {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState([]);
  const [activeOrgId, setActiveOrgId] = useState(null);
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOrg, setNewOrg] = useState({ name: "", org_type: "advisory", description: "" });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("org_member");
  const [inviting, setInviting] = useState(false);

  const loadOrgs = async () => {
    setLoading(true);
    try {
      const r = await api.get("/orgs/mine");
      setOrgs(r.data);
      if (r.data.length && !activeOrgId) setActiveOrgId(r.data[0].id);
      if (!r.data.length) { setMembers([]); setInvites([]); }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load orgs");
    }
    setLoading(false);
  };

  const loadOrgDetail = async (orgId) => {
    if (!orgId) return;
    try {
      const [ms, ivs] = await Promise.all([
        api.get(`/orgs/${orgId}/members`),
        api.get(`/orgs/${orgId}/invites`).catch(() => ({ data: [] })),
      ]);
      setMembers(ms.data);
      setInvites(ivs.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load org details");
    }
  };

  useEffect(() => { loadOrgs(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { loadOrgDetail(activeOrgId); }, [activeOrgId]);

  const createOrg = async (e) => {
    e.preventDefault();
    if (!newOrg.name.trim()) return;
    setCreating(true);
    try {
      const r = await api.post("/orgs", newOrg);
      toast.success(`Created "${r.data.name}"`);
      setShowCreate(false);
      setNewOrg({ name: "", org_type: "advisory", description: "" });
      await loadOrgs();
      setActiveOrgId(r.data.id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to create org");
    }
    setCreating(false);
  };

  const inviteMember = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !activeOrgId) return;
    setInviting(true);
    try {
      const r = await api.post(`/orgs/${activeOrgId}/invites`, {
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      });
      toast.success(`Invite sent to ${inviteEmail}`);
      setInviteEmail("");
      if (r.data?.accept_url && navigator.clipboard) {
        navigator.clipboard.writeText(r.data.accept_url).catch(() => {});
      }
      await loadOrgDetail(activeOrgId);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Invite failed");
    }
    setInviting(false);
  };

  const removeMember = async (memberId, name) => {
    if (!window.confirm(`Remove ${name || "this member"} from the org?`)) return;
    try {
      await api.delete(`/orgs/${activeOrgId}/members/${memberId}`);
      toast.success("Member removed");
      await loadOrgDetail(activeOrgId);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Remove failed");
    }
  };

  const revokeInvite = async (iid) => {
    try {
      await api.delete(`/orgs/${activeOrgId}/invites/${iid}`);
      toast.success("Invite revoked");
      await loadOrgDetail(activeOrgId);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Revoke failed");
    }
  };

  const activeOrg = orgs.find((o) => o.id === activeOrgId);
  const isAdmin = activeOrg?.my_role === "org_admin" || user?.role === "admin";

  return (
    <Layout>
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6" data-testid="org-page">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="overline mb-1">Workspace</div>
            <h1 className="font-display text-3xl tracking-tighter font-medium flex items-center gap-3">
              <Buildings size={28} className="text-[var(--wz-gold)]" />
              Organizations
            </h1>
            <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-xl">
              Orgs let agents, brokers and analyst teams collaborate on listings and research.
              Listings and deal rooms attached to an org survive any individual leaving.
            </p>
          </div>
          <button
            data-testid="org-create-toggle"
            onClick={() => setShowCreate((s) => !s)}
            className="wz-btn wz-btn-gold flex items-center gap-2"
          >
            <Plus size={14} /> New organization
          </button>
        </div>

        {showCreate && (
          <form onSubmit={createOrg} className="wz-card p-5 sm:p-6 space-y-4" data-testid="org-create-form">
            <h3 className="text-lg font-display tracking-tight">Create an organization</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <div className="overline mb-2">Name *</div>
                <input
                  data-testid="org-create-name"
                  required minLength={2}
                  className="wz-input"
                  value={newOrg.name}
                  onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
                  placeholder="Smith Advisory Group"
                />
              </label>
              <label className="block">
                <div className="overline mb-2">Type</div>
                <select
                  data-testid="org-create-type"
                  className="wz-input"
                  value={newOrg.org_type}
                  onChange={(e) => setNewOrg({ ...newOrg, org_type: e.target.value })}
                >
                  <option value="advisory">Advisory / Broker</option>
                  <option value="fund">Investment Fund</option>
                  <option value="corporate">Corporate Dev</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="block col-span-1 sm:col-span-2">
                <div className="overline mb-2">Description</div>
                <input
                  data-testid="org-create-desc"
                  className="wz-input"
                  value={newOrg.description}
                  onChange={(e) => setNewOrg({ ...newOrg, description: e.target.value })}
                  placeholder="Optional — what your team does"
                />
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="wz-btn wz-btn-ghost">Cancel</button>
              <button type="submit" disabled={creating} data-testid="org-create-submit" className="wz-btn wz-btn-gold">
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="text-sm text-[var(--wz-text-tertiary)]">Loading…</div>
        ) : orgs.length === 0 ? (
          <div className="wz-card p-8 text-center" data-testid="org-empty-state">
            <Buildings size={32} className="mx-auto text-[var(--wz-text-tertiary)] mb-3" />
            <h3 className="font-display text-xl mb-2">You don't belong to an org yet</h3>
            <p className="text-sm text-[var(--wz-text-secondary)] max-w-md mx-auto mb-5">
              Create one to invite your team and centralize listings, research, and deal rooms.
              You can also wait for an invitation from someone else.
            </p>
            <button onClick={() => setShowCreate(true)} className="wz-btn wz-btn-gold inline-flex items-center gap-2">
              <Plus size={14} /> Create your first organization
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" data-testid="org-tabs">
              {orgs.map((o) => (
                <button
                  key={o.id}
                  data-testid={`org-tab-${o.id}`}
                  onClick={() => setActiveOrgId(o.id)}
                  className={`text-xs px-3 py-2 border ${
                    activeOrgId === o.id
                      ? "border-[var(--wz-gold)] bg-[var(--wz-gold)]/10 text-[var(--wz-gold)]"
                      : "border-[var(--wz-border)] text-[var(--wz-text-secondary)] hover:border-[var(--wz-text-tertiary)]"
                  }`}
                >
                  {o.name} · <span className="opacity-70">{o.my_role.replace("_", " ")}</span>
                </button>
              ))}
            </div>

            {activeOrg && (
              <div className="wz-card p-5 sm:p-6" data-testid="org-detail">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="overline mb-1">{activeOrg.org_type}</div>
                    <h2 className="font-display text-2xl tracking-tighter">{activeOrg.name}</h2>
                    {activeOrg.description && (
                      <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-xl">{activeOrg.description}</p>
                    )}
                  </div>
                  <button onClick={() => loadOrgDetail(activeOrgId)} className="wz-btn wz-btn-ghost text-xs" data-testid="org-refresh">
                    <ArrowsClockwise size={12} /> Refresh
                  </button>
                </div>

                {/* Members */}
                <div className="mb-6">
                  <div className="overline mb-3">Members · {members.length}</div>
                  <div className="border border-[var(--wz-border)] divide-y divide-[var(--wz-border)]" data-testid="org-members">
                    {members.map((m) => (
                      <div key={m.user_id} className="flex items-center justify-between p-3" data-testid={`org-member-${m.user_id}`}>
                        <div>
                          <div className="text-sm font-medium">{m.name}</div>
                          <div className="text-xs text-[var(--wz-text-tertiary)]">
                            {m.email} · platform: {m.platform_role} · org: {m.org_role.replace("_", " ")}
                          </div>
                        </div>
                        {isAdmin && m.user_id !== user.id && (
                          <button
                            data-testid={`org-member-remove-${m.user_id}`}
                            onClick={() => removeMember(m.user_id, m.name)}
                            className="text-xs text-[var(--wz-danger)] hover:underline flex items-center gap-1"
                          >
                            <Trash size={12} /> Remove
                          </button>
                        )}
                      </div>
                    ))}
                    {members.length === 0 && <div className="p-4 text-xs text-[var(--wz-text-tertiary)]">No members yet.</div>}
                  </div>
                </div>

                {/* Invite + pending invites */}
                {isAdmin && (
                  <>
                    <div className="mb-4">
                      <div className="overline mb-3">Invite a member</div>
                      <form onSubmit={inviteMember} className="flex flex-col sm:flex-row gap-2" data-testid="org-invite-form">
                        <input
                          data-testid="org-invite-email"
                          type="email" required
                          placeholder="email@company.com"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          className="wz-input flex-1"
                        />
                        <select
                          data-testid="org-invite-role"
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value)}
                          className="wz-input sm:w-44"
                        >
                          <option value="org_member">Member</option>
                          <option value="org_admin">Admin</option>
                        </select>
                        <button type="submit" disabled={inviting} data-testid="org-invite-submit" className="wz-btn wz-btn-gold flex items-center gap-2">
                          <UserPlus size={14} /> {inviting ? "Sending…" : "Invite"}
                        </button>
                      </form>
                      <p className="text-[11px] text-[var(--wz-text-tertiary)] mt-2">
                        Invite email is sent via Resend. Accept URL is also copied to your clipboard.
                      </p>
                    </div>

                    <div>
                      <div className="overline mb-3">Pending invites · {invites.length}</div>
                      {invites.length === 0 ? (
                        <div className="text-xs text-[var(--wz-text-tertiary)]">No pending invites.</div>
                      ) : (
                        <div className="border border-[var(--wz-border)] divide-y divide-[var(--wz-border)]" data-testid="org-pending-invites">
                          {invites.map((iv) => (
                            <div key={iv.id} className="flex items-center justify-between p-3">
                              <div>
                                <div className="text-sm">{iv.email}</div>
                                <div className="text-xs text-[var(--wz-text-tertiary)]">
                                  {iv.role.replace("_", " ")} · expires {new Date(iv.expires_at).toLocaleDateString()}
                                </div>
                              </div>
                              <button onClick={() => revokeInvite(iv.id)} className="text-xs text-[var(--wz-danger)] hover:underline" data-testid={`org-invite-revoke-${iv.id}`}>
                                Revoke
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
