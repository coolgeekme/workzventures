import axios from "axios";
import { clearSessionCookie } from "./sessionCookie";
import { splitHostingEnabled, marketingUrl } from "./hostRouting";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("wz_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem("wz_token");
      localStorage.removeItem("wz_user");
      clearSessionCookie("wz_token");
      clearSessionCookie("wz_user");
      if (!window.location.pathname.startsWith("/login")) {
        // On split hosting, /login lives on the marketing apex (not the app
        // subdomain) — redirect there so the user can sign in cleanly.
        window.location.href = splitHostingEnabled() ? marketingUrl("/login") : "/login";
      }
    }
    return Promise.reject(err);
  }
);
