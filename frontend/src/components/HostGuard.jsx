import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  splitHostingEnabled,
  appUrl,
  marketingUrl,
  onAppHostname,
  onMarketingHostname,
} from "../lib/hostRouting";

// Paths that belong on the marketing apex (nextcapos.com).
// /accept-invite is intentionally allowed on the app subdomain too, because
// invite emails may link directly to the app host.
const MARKETING_PATHS = new Set([
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

/**
 * Enforces the marketing-apex / app-subdomain split.
 *
 *  - /app/* must run on app.nextcapos.com -> bounce there.
 *  - /, /login, /register, /forgot-password, /reset-password must run on
 *    nextcapos.com -> bounce there.
 *  - If an authenticated user lands on the apex root, forward them into
 *    /app/dashboard on the subdomain.
 *
 * Inert when REACT_APP_APP_URL is not set (preview / dev).
 */
export default function HostGuard() {
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    if (!splitHostingEnabled()) return;
    const path = location.pathname || "/";
    const search = location.search || "";

    // Public preview links work on either domain — never redirect them.
    if (path.startsWith("/preview/listing/")) return;

    // /app/* belongs on the app subdomain.
    if (path.startsWith("/app") && !onAppHostname()) {
      window.location.replace(appUrl(path + search));
      return;
    }

    // Marketing/auth helper paths belong on the apex.
    if (MARKETING_PATHS.has(path) && onAppHostname()) {
      window.location.replace(marketingUrl(path + search));
      return;
    }

    // Authenticated user on the marketing root -> deep-link into the app.
    if (user && onMarketingHostname() && path === "/") {
      window.location.replace(appUrl("/app/dashboard"));
    }
  }, [location.pathname, location.search, user]);

  return null;
}
