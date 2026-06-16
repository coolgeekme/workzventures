import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { marketingUrl } from "../lib/hostRouting";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

/**
 * Generic accept-invite page used for both org invitations and listing
 * collaborator invitations. The flow checks the token, asks the user to
 * log in if they aren't, and then POSTs accept.
 *
 * Routes:
 *   /accept-org-invite?token=…    -> kind=org
 *   /accept-listing-invite?token=… -> kind=listing
 */
export default function AcceptCollabInvite({ kind = "org" }) {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const token = sp.get("token");
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const previewPath = kind === "org" ? `/org-invites/${token}` : `/listing-invites/${token}`;
  const acceptPath  = kind === "org" ? `/org-invites/${token}/accept` : `/listing-invites/${token}/accept`;

  const loadInvite = async () => {
    if (!token) { setError("Missing token."); return; }
    try {
      const r = await api.get(previewPath);
      setInvite(r.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "Invite not found");
    }
  };

  useEffect(() => { loadInvite(); }, [token]); // eslint-disable-line

  const accept = async () => {
    if (!user) {
      // Send them to login with a `next` so we can resume.
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `${marketingUrl("/login")}?next=${next}`;
      return;
    }
    if (invite?.email && user.email.toLowerCase() !== invite.email.toLowerCase()) {
      toast.error(`This invite is for ${invite.email}. Sign in with that email to accept.`);
      return;
    }
    setBusy(true);
    try {
      const r = await api.post(acceptPath);
      toast.success("Invitation accepted");
      if (kind === "org") nav("/app/org");
      else nav(`/app/listings`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not accept invite");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 grain relative" data-testid="accept-collab-invite-page">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <div className="w-full max-w-md wz-card p-8 text-center">
        <Logo size="md" testid="accept-invite-logo" />
        {error ? (
          <div className="mt-6">
            <div className="text-[var(--wz-danger)] font-medium">{error}</div>
            <a href={marketingUrl("/")} className="wz-btn wz-btn-ghost text-xs mt-6 inline-block">Back to home</a>
          </div>
        ) : !invite ? (
          <div className="mt-6 text-sm text-[var(--wz-text-secondary)]">Loading invite…</div>
        ) : (
          <>
            <div className="overline mt-4">{kind === "org" ? "Organization invitation" : "Listing invitation"}</div>
            <h1 className="font-display text-2xl tracking-tighter font-medium mt-3 mb-2">
              {kind === "org" ? invite.org_name : invite.listing_name}
            </h1>
            <p className="text-sm text-[var(--wz-text-secondary)] mb-2">
              {invite.invited_by_name ? `${invite.invited_by_name} invited` : "You're invited"} <strong>{invite.email}</strong> as a{" "}
              <span className="text-[var(--wz-gold)]">{(invite.role || "").replace("_", " ")}</span>
            </p>
            {invite.message && (
              <blockquote className="text-xs text-[var(--wz-text-secondary)] border-l-2 border-[var(--wz-gold)] px-3 py-2 my-4 text-left italic">
                "{invite.message}"
              </blockquote>
            )}
            <div className="mt-7 space-y-2">
              {user ? (
                <button data-testid="accept-invite-submit" onClick={accept} disabled={busy} className="wz-btn wz-btn-gold w-full">
                  {busy ? "Accepting…" : "Accept invitation"}
                </button>
              ) : (
                <button onClick={accept} className="wz-btn wz-btn-gold w-full" data-testid="accept-invite-signin">
                  Sign in to accept
                </button>
              )}
              <a href={marketingUrl("/")} className="wz-btn wz-btn-ghost w-full inline-block text-xs">Back to home</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
