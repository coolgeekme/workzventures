import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/**
 * Fund context — the global "which fund am I looking at" selector.
 *
 * Every fund-scoped page (dashboard, portfolio, LPs, capital activity)
 * filters by the fund selected here, the same way the agent workspace mode
 * drives buyer/seller chrome. Built now, ahead of those pages, because
 * retrofitting a global scope selector into screens that already assume a
 * single fund is far more expensive than threading it through from the start.
 *
 * Selection is persisted per-browser. If the stored fund is gone (deleted, or
 * access revoked) we silently fall back to the first available fund.
 */
const KEY = "wz_fund_id";
const EVT = "wz-fund-change";

function readStoredId() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY) || null;
}

export function useFundContext(enabled = true) {
  const [funds, setFunds] = useState([]);
  const [fundId, setFundId] = useState(readStoredId);
  const [loading, setLoading] = useState(Boolean(enabled));

  const load = useCallback(async () => {
    if (!enabled) {
      setFunds([]);
      setLoading(false);
      return;
    }
    try {
      const r = await api.get("/funds");
      const list = Array.isArray(r.data) ? r.data : [];
      setFunds(list);

      // Reconcile the stored selection against what we can actually see.
      const stored = readStoredId();
      const valid = list.some((f) => f.id === stored);
      const next = valid ? stored : list[0]?.id || null;
      if (next !== stored) {
        if (next) localStorage.setItem(KEY, next);
        else localStorage.removeItem(KEY);
      }
      setFundId(next);
    } catch {
      // No funds endpoint / not permitted — treat as "no fund context".
      setFunds([]);
      setFundId(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onChange = () => setFundId(readStoredId());
    window.addEventListener(EVT, onChange);
    const onStorage = (e) => {
      if (e.key === KEY) setFundId(readStoredId());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const selectFund = useCallback((id) => {
    if (!id) return;
    localStorage.setItem(KEY, id);
    window.dispatchEvent(new Event(EVT));
    setFundId(id);
  }, []);

  const activeFund = funds.find((f) => f.id === fundId) || null;

  return { funds, fundId, activeFund, loading, selectFund, reloadFunds: load };
}

/** For non-React callers that need the current scope on an API request. */
export function currentFundId() {
  return readStoredId();
}
