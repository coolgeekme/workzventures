import { createContext, useContext, useEffect, useState, useCallback } from "react";

const ThemeContext = createContext(null);
const STORAGE_KEY = "wz-theme-preference"; // "dark" | "light" | "auto"
const VALID = ["dark", "light", "auto"];

function resolveTheme(pref) {
  if (pref === "auto") {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return "dark";
  }
  return pref;
}

function applyTheme(resolved) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
}

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(() => {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return VALID.includes(stored) ? stored : "dark";
  });
  const [resolved, setResolved] = useState(() => resolveTheme(preference));

  // Apply on mount + whenever preference changes
  useEffect(() => {
    const next = resolveTheme(preference);
    setResolved(next);
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  // Listen for OS theme changes when on auto
  useEffect(() => {
    if (preference !== "auto" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const next = mq.matches ? "light" : "dark";
      setResolved(next);
      applyTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((p) => {
    if (VALID.includes(p)) setPreferenceState(p);
  }, []);

  const cycle = useCallback(() => {
    setPreferenceState((p) => (p === "dark" ? "light" : p === "light" ? "auto" : "dark"));
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference, cycle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
