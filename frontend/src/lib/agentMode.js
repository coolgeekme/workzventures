import { useEffect, useState } from "react";

/**
 * Agent workspace-mode toggle.
 *
 * When a user has role === "agent" they can act as either a buyer or a
 * seller. This hook tracks which "mode" their workspace is in. The sidebar
 * nav and chrome use this to render either the buyer-side or seller-side
 * console. Persisted to localStorage so it survives reloads.
 *
 * Default mode = "seller" (most M&A advisors are primarily sell-side).
 */
const KEY = "wz_agent_mode";
const EVT = "wz-agent-mode-change";

function readMode() {
  if (typeof window === "undefined") return "seller";
  const v = localStorage.getItem(KEY);
  return v === "buyer" ? "buyer" : "seller";
}

export function useAgentMode() {
  const [mode, setMode] = useState(readMode);

  useEffect(() => {
    const onChange = () => setMode(readMode());
    window.addEventListener(EVT, onChange);
    // Cross-tab updates
    window.addEventListener("storage", (e) => { if (e.key === KEY) setMode(readMode()); });
    return () => window.removeEventListener(EVT, onChange);
  }, []);

  const update = (next) => {
    if (next !== "buyer" && next !== "seller") return;
    localStorage.setItem(KEY, next);
    window.dispatchEvent(new Event(EVT));
    setMode(next);
  };

  return [mode, update];
}
