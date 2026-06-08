// Hostname routing for split marketing site / authenticated app.
//
// In production we deploy with REACT_APP_APP_URL set to the app subdomain
// (e.g. https://app.nextcapos.com). Marketing/landing lives on the apex
// (nextcapos.com); everything authenticated lives on the subdomain.
//
// In preview / dev the env var is empty → all CTAs stay relative and the
// app keeps working on a single hostname.

const APP_URL = (process.env.REACT_APP_APP_URL || "").replace(/\/$/, "");

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

/** Returns true if the current page is already running on the app subdomain. */
export function onAppHostname() {
  if (!APP_URL) return true;
  try {
    return window.location.origin === APP_URL;
  } catch {
    return false;
  }
}
