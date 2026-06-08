// Cross-subdomain session cookies.
//
// We continue to use localStorage as the runtime token/user store (so all
// existing axios interceptors keep working unchanged), but we ALSO mirror
// auth into a cookie scoped to `.nextcapos.com` so that signing in on
// nextcapos.com (marketing) hands the session off seamlessly to
// app.nextcapos.com (the authenticated app).
//
// In preview / single-host deployments cookieDomain() returns null and the
// cookie scopes to the current host — this is harmless and keeps preview
// behavior identical.

import { cookieDomain } from "./hostRouting";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function isHttps() {
  try {
    return typeof window !== "undefined" && window.location.protocol === "https:";
  } catch {
    return false;
  }
}

function attrs() {
  const parts = [`Path=/`, `Max-Age=${MAX_AGE_SECONDS}`, `SameSite=Lax`];
  if (isHttps()) parts.push("Secure");
  const dom = cookieDomain();
  if (dom) parts.push(`Domain=${dom}`);
  return parts.join("; ");
}

function clearAttrs() {
  const parts = [`Path=/`, `Max-Age=0`, `SameSite=Lax`];
  if (isHttps()) parts.push("Secure");
  const dom = cookieDomain();
  if (dom) parts.push(`Domain=${dom}`);
  return parts.join("; ");
}

export function setSessionCookie(name, value) {
  if (typeof document === "undefined") return;
  if (value == null) return;
  document.cookie = `${name}=${encodeURIComponent(value)}; ${attrs()}`;
}

export function getSessionCookie(name) {
  if (typeof document === "undefined") return null;
  const row = document.cookie
    .split("; ")
    .find((r) => r.startsWith(`${name}=`));
  if (!row) return null;
  try {
    return decodeURIComponent(row.substring(name.length + 1));
  } catch {
    return null;
  }
}

export function clearSessionCookie(name) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; ${clearAttrs()}`;
}
