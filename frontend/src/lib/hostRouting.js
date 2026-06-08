// Hostname routing for split marketing site / authenticated app.
//
// In production we deploy with REACT_APP_APP_URL set to the app subdomain
// (e.g. https://app.nextcapos.com) and REACT_APP_MARKETING_URL set to the
// apex (e.g. https://nextcapos.com). Marketing/landing/auth-helper pages
// live on the apex; everything in /app/* lives on the subdomain.
//
// In preview / dev these env vars are empty -> all helpers no-op and the
// app keeps working on a single hostname.

const APP_URL = (process.env.REACT_APP_APP_URL || "").replace(/\/$/, "");
const MARKETING_URL = (process.env.REACT_APP_MARKETING_URL || "").replace(/\/$/, "");
const EXPLICIT_COOKIE_DOMAIN = (process.env.REACT_APP_COOKIE_DOMAIN || "").trim();

/** Returns true if the marketing site is on a different hostname from the app. */
export const splitHostingEnabled = () => Boolean(APP_URL);

/**
 * Build a link to an authenticated-app path. On the apex domain (or preview)
 * returns a relative path; once REACT_APP_APP_URL is set it returns an
 * absolute URL on the app subdomain.
 */
export function appUrl(path = "/") {
  if (!APP_URL) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${APP_URL}${p}`;
}

/**
 * Build a link to a marketing-site path. On preview/dev returns the path
 * as-is; in production returns an absolute URL on the apex.
 */
export function marketingUrl(path = "/") {
  if (!MARKETING_URL) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${MARKETING_URL}${p}`;
}

/** Returns true if the current page is already running on the app subdomain. */
export function onAppHostname() {
  if (!APP_URL) return true;
  try {
    return window.location.origin === APP_URL;
  } catch {
    return false;
  }
}

/** Returns true if the current page is running on the marketing apex. */
export function onMarketingHostname() {
  if (!MARKETING_URL) return !APP_URL; // single-host preview: marketing == app
  try {
    return window.location.origin === MARKETING_URL;
  } catch {
    return false;
  }
}

/**
 * Returns the Domain= attribute to use when writing the cross-subdomain
 * session cookie (e.g. ".nextcapos.com"). Falls back to the explicit
 * REACT_APP_COOKIE_DOMAIN override, then derives it from APP_URL.
 * Returns null when split hosting is disabled (preview / single host) —
 * in that case the cookie scopes to the current host automatically.
 */
export function cookieDomain() {
  if (EXPLICIT_COOKIE_DOMAIN) return EXPLICIT_COOKIE_DOMAIN;
  if (!APP_URL) return null;
  try {
    const host = new URL(APP_URL).hostname; // e.g. app.nextcapos.com
    const parts = host.split(".");
    if (parts.length < 2) return null;
    return `.${parts.slice(-2).join(".")}`; // -> .nextcapos.com
  } catch {
    return null;
  }
}
