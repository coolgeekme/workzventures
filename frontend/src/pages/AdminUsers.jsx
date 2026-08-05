import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  UsersThree, PlusCircle, EnvelopeSimple, Pencil, Prohibit, Key, X,
  CheckCircle, Copy, MagnifyingGlass, ThumbsUp, ThumbsDown, Trash,
} from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

const ROLE_OPTIONS = [
  { id: "buyer", label: "Buyer" },
  { id: "seller", label: "Seller" },
  { id: "agent", label: "Advisor (broker / advisor — both sides)" },
  { id: "fund_manager", label: "Fund Manager (funds, LPs, portfolio)" },
  { id: "admin", label: "Admin" },
];

function relativeTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("users"); // users | invites
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const u = await api.get("/admin/users", { params: search ? { q: search } : {} });
      setUsers(u.data || []);
      const inv = await api.get("/admin/invites");
      setInvites(inv.data || []);
    } catch (err) {
      toast.error("Failed to load");
    }
  };
  useEffect(() => { load(); }, [search]); // eslint-disable-line

  const deactivate = async (u) => {
    if (!window.confirm(`Deactivate ${u.email}? They will no longer be able to log in.`)) return;
    try {
      await api.delete(`/admin/users/${u.id}`);
      toast.success("Deactivated");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  // Hard delete — irreversible. Cascades through every record this user owns
  // (listings, vaults, files, locker, research, etc.) and tombstones their
  // audit-log entries to keep the hash chain intact. Two-step confirmation
  // because there's no recovery path.
  const purgeUser = async (u) => {
    const phrase = `DELETE ${u.email}`;
    const typed = window.prompt(
      `⚠️ HARD DELETE — this is permanent and cascades to every listing, ` +
      `vault, file, message and record this user owns. There is no undo.\n\n` +
      `Type exactly:  ${phrase}\n\nto confirm.`
    );
    if (typed !== phrase) {
      if (typed !== null) toast.error("Phrase mismatch — purge cancelled");
      return;
    }
    try {
      const r = await api.post(`/admin/users/${u.id}/purge`);
      const sum = r.data?.summary || {};
      const bits = [];
      if (sum.listings) bits.push(`${sum.listings} listing(s)`);
      if (sum.deal_rooms) bits.push(`${sum.deal_rooms} vault(s)`);
      if (sum.inquiries) bits.push(`${sum.inquiries} inquir(ies)`);
      if (sum.locker_files) bits.push(`${sum.locker_files} locker file(s)`);
      if (sum.user_owned_rows) bits.push(`${sum.user_owned_rows} other record(s)`);
      toast.success(`Purged ${u.email}${bits.length ? " · " + bits.join(", ") : ""}`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Purge failed");
    }
  };

  const revokeInvite = async (inv) => {
    if (!window.confirm(`Revoke invite to ${inv.email}?`)) return;
    try {
      await api.delete(`/admin/invites/${inv.id}`);
      toast.success("Revoked");
      load();
    } catch (err) {
      toast.error("Failed");
    }
  };

  const resendInvite = async (inv) => {
    try {
      const r = await api.post(`/admin/invites/${inv.id}/resend`);
      toast.success(`Invitation email re-sent to ${r.data.email}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Resend failed");
    }
  };

  const approve = async (u) => {
    try {
      await api.post(`/admin/users/${u.id}/approve`);
      toast.success(`Approved · ${u.email}`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  const reject = async (u) => {
    if (!window.confirm(`Reject access for ${u.email}?`)) return;
    try {
      await api.post(`/admin/users/${u.id}/reject`);
      toast.success("Rejected");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1600px] mx-auto w-full" data-testid="admin-users-page">
      <div className="overline mb-3" style={{ color: "var(--wz-gold)" }}>Administrator console</div>
      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium flex items-center gap-3">
            <UsersThree size={28} className="text-[var(--wz-gold)]" />
            User management
          </h1>
          <p className="text-sm text-[var(--wz-text-secondary)] mt-2 max-w-2xl">
            Invite new buyers, sellers, or admins; edit roles; deactivate accounts; or send a one-time
            invite link.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="open-invite-modal"
            onClick={() => setInviteOpen(true)}
            className="wz-btn wz-btn-ghost"
          >
            <EnvelopeSimple size={14} /> Invite
          </button>
          <button
            data-testid="open-create-modal"
            onClick={() => setCreateOpen(true)}
            className="wz-btn wz-btn-gold"
          >
            <PlusCircle size={14} /> Add user
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <button
          data-testid="tab-users"
          onClick={() => setTab("users")}
          className={`text-xs px-3 py-1.5 border ${tab === "users" ? "border-[var(--wz-gold)] bg-[var(--wz-surface-hover)]" : "border-[var(--wz-border)]"}`}
        >
          Users ({users.length})
        </button>
        <button
          data-testid="tab-invites"
          onClick={() => setTab("invites")}
          className={`text-xs px-3 py-1.5 border ${tab === "invites" ? "border-[var(--wz-gold)] bg-[var(--wz-surface-hover)]" : "border-[var(--wz-border)]"}`}
        >
          Pending invites ({invites.filter((i) => i.status === "pending").length})
        </button>
        {tab === "users" && (
          <div className="ml-auto flex items-center gap-2 wz-input px-3 py-1.5 max-w-xs">
            <MagnifyingGlass size={12} className="text-[var(--wz-text-tertiary)]" />
            <input
              data-testid="user-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search email, name, org…"
              className="bg-transparent text-xs outline-none flex-1"
            />
          </div>
        )}
      </div>

      <div className="wz-card p-0 overflow-hidden">
        {tab === "users" ? (
          <table className="w-full text-xs">
            <thead className="bg-[var(--wz-surface-2)] text-[var(--wz-text-tertiary)] uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2.5 font-normal">User</th>
                <th className="text-left px-4 py-2.5 font-normal">Role</th>
                <th className="text-left px-4 py-2.5 font-normal">Org</th>
                <th className="text-left px-4 py-2.5 font-normal">Status</th>
                <th className="text-left px-4 py-2.5 font-normal">Created</th>
                <th className="text-right px-4 py-2.5 font-normal w-[1%]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--wz-text-tertiary)]">No users match.</td></tr>
              ) : users.map((u) => (
                <tr
                  key={u.id}
                  data-testid={`user-row-${u.id}`}
                  className="border-t border-[var(--wz-border)] hover:bg-[var(--wz-surface-hover)]"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--wz-text)]">{u.name}</div>
                    <div className="text-[10px] text-[var(--wz-text-tertiary)]">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`pill ${u.role === "admin" ? "pill-gold" : u.role === "agent" ? "pill-gold" : u.role === "seller" ? "pill-positive" : "pill-amber"}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--wz-text-secondary)]">{u.organization || "—"}</td>
                  <td className="px-4 py-3">
                    {u.status === "deactivated" ? (
                      <span className="pill pill-negative">deactivated</span>
                    ) : u.status === "rejected" ? (
                      <span className="pill pill-negative">rejected</span>
                    ) : u.status === "pending" ? (
                      <span className="pill pill-amber">pending approval</span>
                    ) : u.is_demo ? (
                      <span className="pill pill-gold">demo (seed)</span>
                    ) : (
                      <span className="text-[var(--wz-positive)]">active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--wz-text-tertiary)]">{relativeTime(u.created_at)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {u.status === "pending" && (
                      <>
                        <button
                          data-testid={`approve-${u.id}`}
                          onClick={() => approve(u)}
                          className="wz-btn wz-btn-ghost text-[11px] mr-1 text-[var(--wz-positive)]"
                          title="Approve access"
                        >
                          <ThumbsUp size={11} /> Approve
                        </button>
                        <button
                          data-testid={`reject-${u.id}`}
                          onClick={() => reject(u)}
                          className="wz-btn wz-btn-ghost text-[11px] mr-1 text-[var(--wz-negative)]"
                          title="Reject"
                        >
                          <ThumbsDown size={11} />
                        </button>
                      </>
                    )}
                    <button
                      data-testid={`edit-${u.id}`}
                      onClick={() => setEditing(u)}
                      className="wz-btn wz-btn-ghost text-[11px] mr-1"
                      title="Edit"
                    >
                      <Pencil size={11} />
                    </button>
                    {u.status !== "deactivated" && !u.is_demo && u.id !== me?.id && (
                      <button
                        data-testid={`deactivate-${u.id}`}
                        onClick={() => deactivate(u)}
                        className="wz-btn wz-btn-ghost text-[11px] text-[var(--wz-negative)] mr-1"
                        title="Deactivate (soft — they can be reactivated)"
                      >
                        <Prohibit size={11} />
                      </button>
                    )}
                    {!u.is_demo && !u.is_seed && u.id !== me?.id && (
                      <button
                        data-testid={`purge-${u.id}`}
                        onClick={() => purgeUser(u)}
                        className="wz-btn wz-btn-ghost text-[11px] text-[var(--wz-negative)] border border-transparent hover:border-[var(--wz-negative)]"
                        title="Hard delete — permanently removes user and all their data"
                      >
                        <Trash size={11} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-[var(--wz-surface-2)] text-[var(--wz-text-tertiary)] uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2.5 font-normal">Email</th>
                <th className="text-left px-4 py-2.5 font-normal">Role</th>
                <th className="text-left px-4 py-2.5 font-normal">Invited by</th>
                <th className="text-left px-4 py-2.5 font-normal">Status</th>
                <th className="text-left px-4 py-2.5 font-normal">Expires</th>
                <th className="text-right px-4 py-2.5 font-normal w-[1%]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--wz-text-tertiary)]">No invites yet.</td></tr>
              ) : invites.map((inv) => (
                <tr key={inv.id} data-testid={`invite-row-${inv.id}`} className="border-t border-[var(--wz-border)]">
                  <td className="px-4 py-3 font-medium">{inv.email}</td>
                  <td className="px-4 py-3 capitalize">{inv.role}</td>
                  <td className="px-4 py-3 text-[var(--wz-text-tertiary)]">{inv.invited_by_email || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`pill ${inv.status === "pending" ? "pill-amber" : inv.status === "accepted" ? "pill-positive" : "pill-negative"}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--wz-text-tertiary)]">{relativeTime(inv.expires_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {inv.status === "pending" && (
                      <div className="inline-flex gap-2">
                        <button
                          data-testid={`resend-${inv.id}`}
                          onClick={() => resendInvite(inv)}
                          className="wz-btn wz-btn-ghost text-[11px] text-[var(--wz-gold)]"
                          title="Re-send the invitation email"
                        >
                          Resend email
                        </button>
                        <button
                          data-testid={`revoke-${inv.id}`}
                          onClick={() => revokeInvite(inv)}
                          className="wz-btn wz-btn-ghost text-[11px] text-[var(--wz-negative)]"
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); load(); }}
        />
      )}
      {inviteOpen && (
        <InviteUserModal
          onClose={() => setInviteOpen(false)}
          onCreated={() => { setInviteOpen(false); load(); }}
        />
      )}
      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    // Top-anchored modal with viewport-scroll fallback. Previous `items-center`
    // pushed the modal off-screen vertically when the form was taller than the
    // viewport (admin had to scroll the whole page to find it).
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="wz-card w-full max-w-md p-5 mt-16 sm:mt-20 mb-12"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg">{title}</h2>
          <button onClick={onClose} className="text-[var(--wz-text-tertiary)] hover:text-[var(--wz-text)]"><X size={16} /></button>
        </div>
        {children}
      </div>
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

function CreateUserModal({ onClose, onCreated }) {
  const [f, setF] = useState({ email: "", name: "", password: "", role: "buyer", organization: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/admin/users", f);
      toast.success("User created");
      onCreated();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };
  return (
    <ModalShell title="Add user directly" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Email">
          <input data-testid="create-email" required type="email" className="wz-input" value={f.email} onChange={(e) => setF({...f, email: e.target.value})} />
        </Field>
        <Field label="Full name">
          <input data-testid="create-name" required className="wz-input" value={f.name} onChange={(e) => setF({...f, name: e.target.value})} />
        </Field>
        <Field label="Role">
          <select data-testid="create-role" className="wz-input" value={f.role} onChange={(e) => setF({...f, role: e.target.value})}>
            {ROLE_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Organization (optional)">
          <input data-testid="create-org" className="wz-input" value={f.organization} onChange={(e) => setF({...f, organization: e.target.value})} />
        </Field>
        <Field label="Temporary password (8+ chars, mix)">
          <input data-testid="create-password" required minLength={8} type="text" className="wz-input" value={f.password} onChange={(e) => setF({...f, password: e.target.value})} />
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="wz-btn wz-btn-ghost text-xs">Cancel</button>
          <button data-testid="create-submit" type="submit" disabled={busy} className="wz-btn wz-btn-gold text-xs">{busy ? "Creating…" : "Create user"}</button>
        </div>
      </form>
    </ModalShell>
  );
}

function InviteUserModal({ onClose, onCreated }) {
  const [f, setF] = useState({ email: "", name: "", role: "buyer", organization: "", expires_hours: 168 });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post("/admin/invites", f);
      setResult(r.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };
  const copyLink = () => {
    navigator.clipboard.writeText(result.accept_url);
    toast.success("Link copied");
  };
  return (
    <ModalShell title={result ? "Invite created" : "Invite a new user"} onClose={() => { if (result) onCreated(); else onClose(); }}>
      {result ? (
        <div className="text-xs leading-relaxed">
          <div className="flex items-center gap-2 mb-3 text-[var(--wz-positive)]">
            <CheckCircle size={16} weight="fill" /> Invite sent to {result.email}.
          </div>
          <div className="text-[var(--wz-text-secondary)] mb-2">
            Share this one-time link with them. It expires {relativeTime(result.expires_at)}.
          </div>
          <div className="wz-input p-2 break-all font-mono text-[11px]">{result.accept_url}</div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={copyLink} className="wz-btn wz-btn-ghost text-xs"><Copy size={11} /> Copy link</button>
            <button onClick={onCreated} className="wz-btn wz-btn-gold text-xs">Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <Field label="Email">
            <input data-testid="invite-email" required type="email" className="wz-input" value={f.email} onChange={(e) => setF({...f, email: e.target.value})} />
          </Field>
          <Field label="Name (optional)">
            <input data-testid="invite-name" className="wz-input" value={f.name} onChange={(e) => setF({...f, name: e.target.value})} />
          </Field>
          <Field label="Role">
            <select data-testid="invite-role" className="wz-input" value={f.role} onChange={(e) => setF({...f, role: e.target.value})}>
              {ROLE_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Organization (optional)">
            <input data-testid="invite-org" className="wz-input" value={f.organization} onChange={(e) => setF({...f, organization: e.target.value})} />
          </Field>
          <Field label="Expires in (hours)">
            <input data-testid="invite-expires" type="number" min={1} max={720} className="wz-input" value={f.expires_hours} onChange={(e) => setF({...f, expires_hours: Number(e.target.value)})} />
          </Field>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={onClose} className="wz-btn wz-btn-ghost text-xs">Cancel</button>
            <button data-testid="invite-submit" type="submit" disabled={busy} className="wz-btn wz-btn-gold text-xs">{busy ? "Creating…" : "Generate invite link"}</button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}

function EditUserModal({ user, onClose, onSaved }) {
  const [f, setF] = useState({ name: user.name, role: user.role, organization: user.organization || "" });
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/admin/users/${user.id}`, f);
      if (pw) await api.post(`/admin/users/${user.id}/password`, { password: pw });
      toast.success("Saved");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };
  return (
    <ModalShell title={`Edit · ${user.email}`} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Full name">
          <input data-testid="edit-name" required className="wz-input" value={f.name} onChange={(e) => setF({...f, name: e.target.value})} />
        </Field>
        <Field label="Role">
          <select data-testid="edit-role" className="wz-input" value={f.role} onChange={(e) => setF({...f, role: e.target.value})}>
            {ROLE_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Organization">
          <input data-testid="edit-org" className="wz-input" value={f.organization} onChange={(e) => setF({...f, organization: e.target.value})} />
        </Field>
        <Field label="Reset password (optional)">
          <input data-testid="edit-password" type="text" className="wz-input" placeholder="Leave blank to keep current" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="wz-btn wz-btn-ghost text-xs">Cancel</button>
          <button data-testid="edit-submit" type="submit" disabled={busy} className="wz-btn wz-btn-gold text-xs">{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </ModalShell>
  );
}
