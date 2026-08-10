import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, PlusCircle, Copy, Trash, X, Lock } from "@phosphor-icons/react";
import { api } from "../lib/api";

/**
 * Roles & permissions (Phase 1.75c).
 *
 * The permission list and scope list are fetched from /permissions/catalog
 * rather than hardcoded here, so the editor can never drift from what the
 * backend actually accepts — a permission the API doesn't know about simply
 * cannot be rendered, let alone granted.
 */

function Field({ label, hint, children }) {
  return (
    <label className="block mb-3">
      <div className="overline mb-1">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-[var(--wz-text-tertiary)] mt-1">{hint}</div>}
    </label>
  );
}

function ModalShell({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8">
      <div className={`wz-card w-full ${wide ? "max-w-3xl" : "max-w-md"} p-5`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display tracking-tight">{title}</h3>
          <button onClick={onClose} className="wz-btn wz-btn-ghost p-1"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Group permission keys by their prefix so the matrix reads as modules. */
function groupPermissions(perms) {
  const groups = {};
  for (const p of perms) {
    const mod = p.key.split(".")[0];
    (groups[mod] = groups[mod] || []).push(p);
  }
  return groups;
}

function RoleEditor({ role, catalog, onClose, onSaved }) {
  const isNew = !role.id;
  const [name, setName] = useState(role.name || "");
  const [description, setDescription] = useState(role.description || "");
  const [perms, setPerms] = useState(role.permissions || {});
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => groupPermissions(catalog.permissions), [catalog]);

  const setScope = (key, scope) =>
    setPerms((p) => {
      const next = { ...p };
      if (scope === "none") delete next[key];
      else next[key] = scope;
      return next;
    });

  const setGroupScope = (mod, scope) =>
    setPerms((p) => {
      const next = { ...p };
      for (const item of groups[mod]) {
        if (scope === "none") delete next[item.key];
        else next[item.key] = scope;
      }
      return next;
    });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name, description, permissions: perms };
      if (isNew) await api.post("/roles", body);
      else await api.patch(`/roles/${role.id}`, body);
      toast.success(isNew ? "Role created" : "Role saved");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not save the role");
    } finally {
      setBusy(false);
    }
  };

  const granted = Object.keys(perms).length;

  return (
    <ModalShell wide title={isNew ? "New role" : `Edit · ${role.name}`} onClose={onClose}>
      <form onSubmit={save}>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Role name">
            <input data-testid="role-name" required className="wz-input" value={name}
                   onChange={(e) => setName(e.target.value)} placeholder="e.g. Director" />
          </Field>
          <Field label="Description">
            <input data-testid="role-description" className="wz-input" value={description}
                   onChange={(e) => setDescription(e.target.value)}
                   placeholder="What this role is for" />
          </Field>
        </div>

        <div className="flex items-center justify-between mt-2 mb-2">
          <div className="overline">Permissions</div>
          <div className="text-[11px] text-[var(--wz-text-tertiary)]">
            {granted} of {catalog.permissions.length} granted
          </div>
        </div>
        <p className="text-[11px] text-[var(--wz-text-tertiary)] mb-3">
          Each permission has a scope: what the role can do, and whose records it applies to.
        </p>

        <div className="max-h-[46vh] overflow-y-auto pr-1">
          {Object.entries(groups).map(([mod, items]) => (
            <div key={mod} className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="overline">{mod}</div>
                <select
                  aria-label={`Set all ${mod} permissions`}
                  className="wz-input text-[11px] py-0.5 px-1 w-auto"
                  value=""
                  onChange={(e) => { if (e.target.value) setGroupScope(mod, e.target.value); e.target.value = ""; }}
                >
                  <option value="">set all…</option>
                  {catalog.scopes.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              {items.map((p) => (
                <div key={p.key} className="flex items-center gap-3 py-1 border-b border-[var(--wz-border)] last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate">{p.label}</div>
                    <div className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)]">{p.key}</div>
                  </div>
                  <select
                    data-testid={`perm-${p.key}`}
                    className="wz-input text-[11px] py-1 w-56"
                    value={perms[p.key] || "none"}
                    onChange={(e) => setScope(p.key, e.target.value)}
                  >
                    {catalog.scopes.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="wz-btn wz-btn-ghost text-xs">Cancel</button>
          <button data-testid="role-submit" type="submit" disabled={busy} className="wz-btn wz-btn-gold text-xs">
            {busy ? "Saving…" : isNew ? "Create role" : "Save changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export default function AdminRoles() {
  const [roles, setRoles] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [r, c] = await Promise.all([api.get("/roles"), api.get("/permissions/catalog")]);
      setRoles(r.data || []);
      setCatalog(c.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not load roles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const duplicate = async (role) => {
    try {
      await api.post(`/roles/${role.id}/duplicate`);
      toast.success(`Duplicated ${role.name}`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not duplicate");
    }
  };

  const remove = async (role) => {
    if (!window.confirm(`Delete the role "${role.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/roles/${role.id}`);
      toast.success("Role deleted");
      load();
    } catch (err) {
      // 409 here means people still hold the role — surface the count as-is.
      toast.error(err?.response?.data?.detail || "Could not delete");
    }
  };

  return (
    <div data-testid="roles-page" className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <h1 className="font-display text-3xl sm:text-4xl tracking-tighter font-medium flex items-center gap-3">
          <ShieldCheck size={28} className="text-[var(--wz-gold)]" />
          Roles &amp; permissions
        </h1>
        <div className="ml-auto">
          <button
            data-testid="role-new"
            className="wz-btn wz-btn-gold flex items-center gap-2"
            onClick={() => setEditing({ name: "", description: "", permissions: {} })}
            disabled={!catalog}
          >
            <PlusCircle size={14} /> New role
          </button>
        </div>
      </div>
      <p className="text-sm text-[var(--wz-text-secondary)] mb-6 max-w-2xl">
        Define what each role can do, and whose records it applies to. Built-in roles are
        read-only — duplicate one to build on it.
      </p>

      <div className="wz-card p-0 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left">
              <th className="overline px-4 py-3">Role</th>
              <th className="overline px-4 py-3">Permissions</th>
              <th className="overline px-4 py-3">Type</th>
              <th className="overline px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-[var(--wz-text-tertiary)]">Loading…</td></tr>
            )}
            {!loading && roles.map((r) => (
              <tr key={r.id} data-testid={`role-row-${r.id}`} className="border-t border-[var(--wz-border)]">
                <td className="px-4 py-3">
                  <div className="font-medium">{r.name}</div>
                  {r.description && (
                    <div className="text-[11px] text-[var(--wz-text-tertiary)]">{r.description}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-[var(--wz-text-secondary)]">
                  {Object.keys(r.permissions || {}).length}
                </td>
                <td className="px-4 py-3">
                  {r.is_system
                    ? <span className="pill flex items-center gap-1 w-fit"><Lock size={10} /> Built-in</span>
                    : <span className="pill pill-gold w-fit">Custom</span>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    className="wz-btn wz-btn-ghost text-[11px] mr-1"
                    onClick={() => setEditing(r)}
                    disabled={r.is_system}
                    title={r.is_system ? "Built-in roles cannot be edited — duplicate to customise" : "Edit"}
                  >
                    Edit
                  </button>
                  <button className="wz-btn wz-btn-ghost text-[11px] mr-1" onClick={() => duplicate(r)}>
                    <Copy size={11} className="inline mr-1" />Duplicate
                  </button>
                  <button
                    className="wz-btn wz-btn-ghost text-[11px] text-[var(--wz-negative)]"
                    onClick={() => remove(r)}
                    disabled={r.is_system}
                    title={r.is_system ? "Built-in roles cannot be deleted" : "Delete"}
                  >
                    <Trash size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && catalog && (
        <RoleEditor
          role={editing}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
