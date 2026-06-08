import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

export default function ResetPassword() {
  const [sp] = useSearchParams();
  const token = sp.get("token");
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!token) { toast.error("Missing reset token"); return; }
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      toast.success("Password updated — please sign in");
      nav("/login");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Reset failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 grain relative" data-testid="reset-page">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <form onSubmit={submit} className="w-full max-w-md wz-card p-7">
        <div className="flex items-center gap-3 mb-6">
          <Logo size="md" />
          <div className="overline">Set new password</div>
        </div>
        {!token ? (
          <p className="text-sm text-[var(--wz-rose)]">Missing reset token. Use the link from your email.</p>
        ) : (
          <>
            <label className="block mb-5">
              <div className="overline mb-1.5">New password (8+ chars)</div>
              <input data-testid="reset-password" required minLength={8} type="password" className="wz-input" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button data-testid="reset-submit" type="submit" disabled={busy} className="wz-btn wz-btn-gold w-full">
              {busy ? "Updating…" : "Update password"}
            </button>
          </>
        )}
        <div className="mt-4 text-xs text-[var(--wz-text-tertiary)] text-center">
          <Link to="/login" className="hover:text-[var(--wz-text)]">Back to sign in</Link>
        </div>
      </form>
    </div>
  );
}
