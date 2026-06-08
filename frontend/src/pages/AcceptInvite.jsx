import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { Warning, CheckCircle } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

export default function AcceptInvite() {
  const [sp] = useSearchParams();
  const token = sp.get("token");
  const nav = useNavigate();
  const { setSession } = useAuth();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const loadInvite = async () => {
    if (!token) { setError("Missing invite token."); return; }
    try {
      const r = await api.get(`/auth/invite/${token}`);
      setInvite(r.data);
      setName(r.data.name || "");
    } catch (err) {
      setError(err?.response?.data?.detail || "Invite not found");
    }
  };

  useEffect(() => { loadInvite(); }, [token]); // eslint-disable-line

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post("/auth/accept-invite", { token, password, name });
      if (setSession) setSession(r.data);
      else {
        localStorage.setItem("wz_token", r.data.token);
        localStorage.setItem("wz_user", JSON.stringify(r.data.user));
      }
      toast.success("Welcome to Workz");
      nav("/app/dashboard");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not accept invite");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 py-8 grain relative" data-testid="accept-invite-page">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <div className="w-full max-w-md wz-card p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-6">
          <Logo size="md" />
          <div className="overline">Accept invitation</div>
        </div>
        {error ? (
          <div className="text-center py-6">
            <Warning size={28} className="text-[var(--wz-amber)] mx-auto mb-3" />
            <div className="text-sm font-medium mb-1">{error}</div>
            <div className="text-xs text-[var(--wz-text-tertiary)]">Ask your administrator to send a new invite.</div>
            <Link to="/" className="wz-btn wz-btn-ghost text-xs mt-4 inline-block">Back to home</Link>
          </div>
        ) : !invite ? (
          <div className="text-xs text-[var(--wz-text-tertiary)] text-center py-10">Loading invite…</div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3 text-xs text-[var(--wz-positive)]">
              <CheckCircle size={14} weight="fill" /> Invite valid for <span className="font-medium text-[var(--wz-text)]">{invite.email}</span>
            </div>
            <p className="text-sm text-[var(--wz-text-secondary)] mb-5 leading-relaxed">
              You&apos;ve been invited to join Workz Ventures as a <span className="capitalize text-[var(--wz-text)] font-medium">{invite.role}</span>{invite.organization ? <> on behalf of <span className="text-[var(--wz-text)]">{invite.organization}</span></> : null}. Set a password to activate your account.
            </p>
            <form onSubmit={submit}>
              <label className="block mb-3">
                <div className="overline mb-1.5">Full name</div>
                <input data-testid="accept-name" required className="wz-input" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block mb-4">
                <div className="overline mb-1.5">Password (8+ chars)</div>
                <input data-testid="accept-password" required minLength={8} type="password" className="wz-input" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <button data-testid="accept-submit" type="submit" disabled={busy} className="wz-btn wz-btn-gold w-full">
                {busy ? "Activating…" : "Activate account"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
