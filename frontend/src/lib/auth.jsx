import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";
import {
  setSessionCookie,
  getSessionCookie,
  clearSessionCookie,
} from "./sessionCookie";

const AuthCtx = createContext(null);

// Hydrate localStorage from the cross-subdomain cookie at module load.
// This is how nextcapos.com -> app.nextcapos.com hands off the session
// after a fresh login: the cookie scoped to `.nextcapos.com` is read here
// before the AuthProvider initializes its `user` state from localStorage.
function hydrateFromCookie() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("wz_token")) return; // already have a session
  const cookieToken = getSessionCookie("wz_token");
  const cookieUser = getSessionCookie("wz_user");
  if (cookieToken) {
    localStorage.setItem("wz_token", cookieToken);
    if (cookieUser) localStorage.setItem("wz_user", cookieUser);
  }
}

hydrateFromCookie();

function persistSession(token, user) {
  const serializedUser = JSON.stringify(user);
  localStorage.setItem("wz_token", token);
  localStorage.setItem("wz_user", serializedUser);
  setSessionCookie("wz_token", token);
  setSessionCookie("wz_user", serializedUser);
}

function clearSession() {
  localStorage.removeItem("wz_token");
  localStorage.removeItem("wz_user");
  clearSessionCookie("wz_token");
  clearSessionCookie("wz_user");
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("wz_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("wz_token");
    if (!token || user) return;
    setLoading(true);
    api.get("/auth/me")
      .then((r) => {
        setUser(r.data);
        localStorage.setItem("wz_user", JSON.stringify(r.data));
        setSessionCookie("wz_user", JSON.stringify(r.data));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const r = await api.post("/auth/login", { email, password });
    persistSession(r.data.token, r.data.user);
    setUser(r.data.user);
    return r.data.user;
  };

  const register = async (payload) => {
    const r = await api.post("/auth/register", payload);
    persistSession(r.data.token, r.data.user);
    setUser(r.data.user);
    return r.data.user;
  };

  const logout = () => {
    clearSession();
    setUser(null);
  };

  const setSession = (payload) => {
    persistSession(payload.token, payload.user);
    setUser(payload.user);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout, setUser, setSession }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
