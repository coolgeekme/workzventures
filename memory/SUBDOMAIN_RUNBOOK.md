# Subdomain split — nextcapos.com (marketing + auth) + app.nextcapos.com (platform)

This runbook gets you to the architecture:

```
nextcapos.com           ── landing + /login + /register + /forgot-password + /reset-password
app.nextcapos.com       ── authenticated platform (/app/dashboard, Vault, Locker, etc.)
```

Single Emergent deployment serves both hostnames. Session is handed off via a
JWT cookie scoped to `.nextcapos.com`, so signing in on the apex transparently
lands the user on the subdomain already authenticated.

---

## Step 1 — Add the second custom domain on Emergent (one-time)

DNS for `app.nextcapos.com` is already pointed at Emergent's edge (same IPs as
the apex). Until Emergent issues a cert for the subdomain, the TLS handshake
will fail. Email **support@emergent.sh**:

> Subject: Add second custom domain to existing deployment
>
> Please add `app.nextcapos.com` as an additional custom domain on the same
> deployment that serves `nextcapos.com` (project ID: `<paste from dashboard>`).
> DNS is already pointing at your edge; we just need the SSL cert/ingress for
> the subdomain.

Once they confirm (usually a few hours), `https://app.nextcapos.com` will
respond with HTTP/2 200.

---

## Step 2 — Production environment variables (Emergent dashboard)

### Frontend

| Variable                     | Value                          |
|------------------------------|--------------------------------|
| `REACT_APP_BACKEND_URL`      | `https://app.nextcapos.com`    |
| `REACT_APP_APP_URL`          | `https://app.nextcapos.com`    |
| `REACT_APP_MARKETING_URL`    | `https://nextcapos.com`        |
| `REACT_APP_COOKIE_DOMAIN`    | `.nextcapos.com` *(optional — derived automatically from `REACT_APP_APP_URL` if omitted)* |

### Backend

| Variable        | Value                                                       |
|-----------------|-------------------------------------------------------------|
| `CORS_ORIGINS`  | `https://nextcapos.com,https://app.nextcapos.com`           |

`MONGO_URL` and `DB_NAME` stay exactly as they are — both hostnames are served
by the same deployment, so they share one database.

---

## Step 3 — Redeploy

Click **Redeploy** in the Emergent dashboard. Verify the user flow end to end:

1. `https://nextcapos.com` → marketing landing page.
2. Click **Sign in** → URL becomes `https://nextcapos.com/login`.
3. Submit demo credentials → **browser redirects to `https://app.nextcapos.com/app/dashboard`** and the session is already established (no second login prompt).
4. Sidebar **Sign out** → bounces back to `https://nextcapos.com/`.
5. Already-authenticated visit to `https://nextcapos.com/` → auto-forwarded to `https://app.nextcapos.com/app/dashboard`.
6. Direct visit to `https://app.nextcapos.com/login` while logged-out → bounced back to `https://nextcapos.com/login`.

---

## How the code routes between hostnames

- `src/lib/hostRouting.js`
  - `splitHostingEnabled()` is true only when `REACT_APP_APP_URL` is set, so preview / dev keep working on a single hostname.
  - `appUrl('/some/path')` and `marketingUrl('/some/path')` build absolute URLs to the right host.
  - `cookieDomain()` returns `.nextcapos.com` in production (derived from `REACT_APP_APP_URL` or overridden via `REACT_APP_COOKIE_DOMAIN`).
- `src/lib/sessionCookie.js` — writes/reads/clears the `wz_token` and `wz_user` cookies with `Domain=.nextcapos.com; Secure; SameSite=Lax; Path=/`.
- `src/lib/auth.jsx`
  - On `login`/`register`/`setSession` we write to **both** `localStorage` (for the axios interceptor) and the cookie (for cross-subdomain handoff).
  - At module load we hydrate `localStorage` from the cookie if it's empty — this is how `app.nextcapos.com` picks up a session that was set on `nextcapos.com`.
  - `logout` clears both.
- `src/components/HostGuard.jsx` enforces:
  - `/app/*` only loads on `app.nextcapos.com` (otherwise hard-redirect).
  - `/`, `/login`, `/register`, `/forgot-password`, `/reset-password` only load on the apex (otherwise hard-redirect).
  - Authenticated user landing on the apex root is forwarded into `/app/dashboard` on the subdomain.
- `src/pages/Login.jsx` — after a successful login, hard-redirects to `appUrl('/app/dashboard')` when split hosting is on; the cookie has already been set so the subdomain picks the session up immediately.
- `src/components/Layout.jsx` — Sign out goes through `logout()` (which clears cookies + localStorage) then bounces to `marketingUrl('/')`.

You do not need to change anything else. Preview / dev keeps using a single hostname and `localStorage` only — none of the cross-subdomain code is active there.

---

## Troubleshooting

- **TLS handshake failure on `app.nextcapos.com`** → Emergent hasn't issued the cert yet (Step 1). Wait or follow up with support.
- **Logged in on apex, redirected to subdomain, but still see Login page** → the cookie probably wasn't accepted by the browser. Check the response headers on the login POST — the cookie must be set client-side from JS (it is — `sessionCookie.js` handles this). Open DevTools → Application → Cookies and confirm `wz_token` with `Domain=.nextcapos.com` is present on both hostnames.
- **CORS blocked** → confirm backend `CORS_ORIGINS` includes both hostnames exactly with `https://` prefix and no trailing slash.
- **Cookie missing the `Secure` flag** → only added when the page is loaded over HTTPS. In local dev (`http://`) the flag is dropped on purpose so cookies still work.
- **User clears cookies / opens incognito** → expected: they'll be asked to log in again on `nextcapos.com/login`.

---

## Future polish (optional)

- Move JWT generation to an HttpOnly cookie set by the backend (instead of the JS-managed cookie we use today). That removes the JWT from `document.cookie` entirely. Requires backend changes — out of scope for the split-host milestone.
- Add a `app.nextcapos.com → nextcapos.com` redirect for `/`, `/about`, etc. (anything that isn't `/app/*` or `/accept-invite`). Already handled by `HostGuard.jsx` for the explicit marketing paths.
