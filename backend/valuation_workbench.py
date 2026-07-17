"""Valuation Workbench — Phase A.

Implements the 5 methods described in the user's IPEV/ASC 820 policy:
  1. Recent Transaction (with time-decay)  — grounded via valuation.py
  2. Market Multiples                       — grounded via valuation.py
  3. Venture Capital Method                 — pure Python (terminal value / IRR)
  4. Discounted Cash Flow                   — pure Python (5-year projection + terminal)
  5. Option Pricing Method                  — Black-Scholes single-class waterfall

Plus:
  * `autofill_workbench()`  — one Claude call that seeds all 5 methods
                              from a target's public footprint (Perplexity + Brave).
  * `compute_all_methods()` — runs the pure-Python computations from stored inputs.
  * `aggregate_band()`      — weighted band across whatever methods have data.

All monetary figures USD unless flagged.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# METHOD 1 + 2 — Recent Transaction & Market Multiples
# For Phase A, the "computation" for these two is trivial (the numbers were
# already returned by the grounded autofill). We expose small helpers so the
# frontend can tweak an assumption (e.g. adjust the time-decay factor) and
# re-derive the value without re-hitting Claude.
# --------------------------------------------------------------------------- #
def compute_recent_transaction(inp: dict) -> dict:
    """Given `{post_money_usd, time_decay_factor}` (both optional), compute the
    adjusted value. Returns `{value_usd, adjusted_value_usd, notes}`."""
    pm = _num(inp.get("post_money_usd"))
    decay = _num(inp.get("time_decay_factor"))
    if pm is None:
        return {"value_usd": None, "adjusted_value_usd": None, "notes": "No priced round on file."}
    if decay is None:
        decay = 1.0
    adj = round(pm * decay)
    return {"value_usd": pm, "adjusted_value_usd": adj, "notes": f"Post-money {_fmt(pm)} × decay {decay} = {_fmt(adj)}."}


def compute_market_multiples(inp: dict) -> dict:
    """Given `{estimated_annual_revenue_usd, median_multiple, size_discount_pct}` compute value."""
    rev = _num(inp.get("estimated_annual_revenue_usd"))
    mult = _num(inp.get("median_multiple"))
    disc = _num(inp.get("size_discount_pct")) or 0.0
    if rev is None or mult is None:
        return {"value_usd": None, "notes": "Revenue or multiple missing."}
    raw = rev * mult
    adjusted = raw * (1 - disc / 100.0)
    return {
        "value_usd": round(adjusted),
        "raw_value_usd": round(raw),
        "notes": f"{_fmt(rev)}/yr × {mult}x = {_fmt(raw)}, less {disc}% size discount → {_fmt(adjusted)}.",
    }


# --------------------------------------------------------------------------- #
# METHOD 3 — Venture Capital Method
# terminal_value = exit_revenue × exit_multiple
# present_value  = terminal_value / (1 + IRR)^years_to_exit
# allocated      = present_value × current_ownership_fraction
# --------------------------------------------------------------------------- #
def compute_vc_method(inp: dict) -> dict:
    rev = _num(inp.get("projected_exit_revenue_usd"))
    mult = _num(inp.get("exit_multiple"))
    years = _num(inp.get("years_to_exit"))
    irr = _num(inp.get("target_irr_pct"))
    ownership = _num(inp.get("current_ownership_pct"))

    missing = [k for k, v in {
        "projected_exit_revenue_usd": rev,
        "exit_multiple": mult,
        "years_to_exit": years,
        "target_irr_pct": irr,
    }.items() if v is None]
    if missing:
        return {"value_usd": None, "notes": f"Missing inputs: {', '.join(missing)}."}

    terminal = rev * mult
    pv = terminal / ((1 + irr / 100.0) ** years)
    allocated = pv * (ownership / 100.0) if ownership else pv

    return {
        "value_usd": round(allocated),
        "terminal_value_usd": round(terminal),
        "present_value_usd": round(pv),
        "notes": (
            f"Terminal @ year {int(years)}: {_fmt(rev)}/yr × {mult}x = {_fmt(terminal)}. "
            f"PV @ {irr}% IRR = {_fmt(pv)}."
            + (f" Allocated to {ownership}% stake = {_fmt(allocated)}." if ownership else "")
        ),
    }


# --------------------------------------------------------------------------- #
# METHOD 4 — Discounted Cash Flow
# Simplified 5-year model:
#   year 1 revenue with a growth_rate_pct compounded → 5 years
#   EBITDA = revenue × ebitda_margin_pct
#   FCF = EBITDA × (1 - tax_rate_pct) - revenue × capex_pct
#   Terminal Value = FCF_year5 × (1 + terminal_growth_pct) / (wacc_pct - terminal_growth_pct)
#   Enterprise Value = Σ FCF_t / (1+WACC)^t   + TV / (1+WACC)^5
# --------------------------------------------------------------------------- #
def compute_dcf(inp: dict) -> dict:
    y1_rev = _num(inp.get("year1_revenue_usd"))
    growth = _num(inp.get("revenue_growth_pct"))
    margin = _num(inp.get("ebitda_margin_pct"))
    capex_pct = _num(inp.get("capex_pct_revenue")) or 0.0
    tax = _num(inp.get("tax_rate_pct"))
    tg = _num(inp.get("terminal_growth_pct"))
    wacc = _num(inp.get("wacc_pct"))

    missing = [k for k, v in {
        "year1_revenue_usd": y1_rev,
        "revenue_growth_pct": growth,
        "ebitda_margin_pct": margin,
        "tax_rate_pct": tax,
        "terminal_growth_pct": tg,
        "wacc_pct": wacc,
    }.items() if v is None]
    if missing:
        return {"value_usd": None, "notes": f"Missing inputs: {', '.join(missing)}."}
    if wacc <= tg:
        return {"value_usd": None, "notes": f"WACC ({wacc}%) must exceed terminal growth ({tg}%)."}

    yearly = []
    rev = y1_rev
    for year in range(1, 6):
        ebitda = rev * margin / 100.0
        after_tax = ebitda * (1 - tax / 100.0)
        capex = rev * capex_pct / 100.0
        fcf = after_tax - capex
        yearly.append({"year": year, "revenue": rev, "ebitda": ebitda, "fcf": fcf})
        rev = rev * (1 + growth / 100.0)

    r = wacc / 100.0
    pv_cf = sum(y["fcf"] / (1 + r) ** y["year"] for y in yearly)
    terminal = yearly[-1]["fcf"] * (1 + tg / 100.0) / (r - tg / 100.0)
    pv_terminal = terminal / (1 + r) ** 5
    ev = pv_cf + pv_terminal

    return {
        "value_usd": round(ev),
        "pv_of_5yr_cash_flows_usd": round(pv_cf),
        "terminal_value_usd": round(terminal),
        "pv_of_terminal_usd": round(pv_terminal),
        "yearly": [{k: round(v) if isinstance(v, (int, float)) and k != "year" else v for k, v in y.items()} for y in yearly],
        "notes": (
            f"5-year FCF PV: {_fmt(pv_cf)}. "
            f"Terminal @ {tg}% growth: {_fmt(terminal)} (PV {_fmt(pv_terminal)}). "
            f"WACC: {wacc}%. Enterprise value: {_fmt(ev)}."
        ),
    }


# --------------------------------------------------------------------------- #
# METHOD 5 — Option Pricing Method (single-class waterfall)
# Treats common shares as a call option on the enterprise value struck at the
# preferred liquidation pref. Uses Black-Scholes.
#   C = V N(d1) − L e^{−rt} N(d2)
#   d1 = [ln(V/L) + (r + σ²/2) t] / (σ √t),  d2 = d1 − σ √t
# Preferred value = V − C (assumes non-participating preferred).
# --------------------------------------------------------------------------- #
def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def compute_option_pricing(inp: dict) -> dict:
    V = _num(inp.get("enterprise_value_usd"))
    L = _num(inp.get("total_preferred_liquidation_pref_usd"))
    sigma = _num(inp.get("volatility_pct"))
    T = _num(inp.get("time_to_liquidity_years"))
    r = _num(inp.get("risk_free_rate_pct")) or 4.0  # sensible default
    common_pct = _num(inp.get("common_share_pct")) or 0.0  # user's stake in common

    missing = [k for k, v in {
        "enterprise_value_usd": V,
        "total_preferred_liquidation_pref_usd": L,
        "volatility_pct": sigma,
        "time_to_liquidity_years": T,
    }.items() if v is None]
    if missing:
        return {"value_usd": None, "notes": f"Missing inputs: {', '.join(missing)}."}
    if L <= 0 or V <= 0 or sigma <= 0 or T <= 0:
        return {"value_usd": None, "notes": "All numeric inputs must be positive."}

    s = sigma / 100.0
    r_dec = r / 100.0
    d1 = (math.log(V / L) + (r_dec + 0.5 * s * s) * T) / (s * math.sqrt(T))
    d2 = d1 - s * math.sqrt(T)
    common_total = V * _norm_cdf(d1) - L * math.exp(-r_dec * T) * _norm_cdf(d2)
    common_total = max(0.0, common_total)
    preferred_total = V - common_total

    allocated_to_stake = common_total * (common_pct / 100.0) if common_pct else common_total

    return {
        "value_usd": round(allocated_to_stake),
        "common_class_value_usd": round(common_total),
        "preferred_class_value_usd": round(preferred_total),
        "d1": round(d1, 4), "d2": round(d2, 4),
        "notes": (
            f"BS common option: strike={_fmt(L)}, EV={_fmt(V)}, σ={sigma}%, T={T}y → "
            f"common={_fmt(common_total)}, preferred={_fmt(preferred_total)}."
            + (f" Your {common_pct}% common stake = {_fmt(allocated_to_stake)}." if common_pct else "")
        ),
    }


# --------------------------------------------------------------------------- #
# AGGREGATION — Weighted band across methods that produced a value
# --------------------------------------------------------------------------- #
DEFAULT_WEIGHTS = {
    "recent_transaction": 0.40,
    "market_multiples":   0.30,
    "vc_method":          0.15,
    "dcf":                0.10,
    "option_pricing":     0.05,
}

METHOD_LABELS = {
    "recent_transaction": "Recent Transaction",
    "market_multiples":   "Market Multiples",
    "vc_method":          "Venture Capital Method",
    "dcf":                "Discounted Cash Flow",
    "option_pricing":     "Option Pricing (BS)",
}


def aggregate_band(methods: dict, weights: dict | None = None) -> dict:
    """Combine per-method outputs into a fair-value band.

    `methods` = {key: {value_usd: number|null, ...}}. Missing / null values are
    excluded from the weighted mean, then remaining weights renormalized.
    """
    weights = weights or DEFAULT_WEIGHTS
    entries: list[tuple[str, float, float]] = []
    for k, m in (methods or {}).items():
        v = _num((m or {}).get("value_usd"))
        w = _num((weights or {}).get(k)) or DEFAULT_WEIGHTS.get(k, 0.0)
        if v is not None and v > 0 and w > 0:
            entries.append((k, v, w))

    if not entries:
        return {
            "low_usd": 0, "base_usd": 0, "high_usd": 0,
            "confidence": "low", "insufficient_data": True,
            "summary": "No methods returned a value.",
            "weights_used": {},
            "included_methods": [],
        }

    total_w = sum(w for _, _, w in entries)
    base = sum(v * w for _, v, w in entries) / total_w

    # Confidence heuristic: how tightly do methods cluster around the base?
    vals = [v for _, v, _ in entries]
    if len(vals) >= 2:
        spread = (max(vals) - min(vals)) / base if base > 0 else 1.0
        if spread <= 0.30:
            conf = "high"
        elif spread <= 0.60:
            conf = "medium"
        else:
            conf = "low"
    else:
        # Single method — cap at medium, wider band
        conf = "medium"
        spread = 0.30

    lo = base * (1 - min(0.5, max(0.15, spread / 2)))
    hi = base * (1 + min(0.5, max(0.15, spread / 2)))

    return {
        "low_usd":  round(lo),
        "base_usd": round(base),
        "high_usd": round(hi),
        "confidence": conf,
        "insufficient_data": False,
        "summary": (
            f"Weighted base of {_fmt(base)} across {len(entries)} method(s): "
            + ", ".join(f"{METHOD_LABELS.get(k, k)} {_fmt(v)}" for k, v, _ in entries)
            + f". Confidence: {conf}."
        ),
        "weights_used": {k: round(w / total_w, 3) for k, _, w in entries},
        "included_methods": [k for k, _, _ in entries],
    }


def compute_all_methods(inputs: dict) -> dict:
    """Given the stored per-method inputs, run all pure-Python computations."""
    return {
        "recent_transaction": compute_recent_transaction(inputs.get("recent_transaction") or {}),
        "market_multiples":   compute_market_multiples(inputs.get("market_multiples")   or {}),
        "vc_method":          compute_vc_method(inputs.get("vc_method")                 or {}),
        "dcf":                compute_dcf(inputs.get("dcf")                             or {}),
        "option_pricing":     compute_option_pricing(inputs.get("option_pricing")       or {}),
    }


# --------------------------------------------------------------------------- #
# AI AUTOFILL — one Claude call that seeds inputs for all 5 methods from a
# target company's public footprint. Grounded in Perplexity + Brave.
# --------------------------------------------------------------------------- #
_AUTOFILL_SYSTEM = """You are a senior private-markets valuation analyst. Given a target company and grounded evidence from the web, produce SEED INPUTS for FIVE valuation methods so a fund manager can review and tune them.

Return STRICT JSON (no prose) with this exact shape:

{
  "recent_transaction": {
    "round_type": "<Seed|Series A|Series B|...|null>",
    "raised_usd": <number|null>,
    "post_money_usd": <number|null>,
    "announced": "<YYYY-MM|null>",
    "time_decay_factor": <0.20-1.00|null>,
    "source_urls": [<url>, ...],
    "notes": "<one sentence>"
  },
  "market_multiples": {
    "comparable_tickers": ["<TICK>", ...],
    "median_multiple": <number|null>,
    "multiple_type": "EV/Revenue|EV/EBITDA|null",
    "estimated_annual_revenue_usd": <number|null>,
    "size_discount_pct": <0-40|null>,
    "revenue_basis": "<one sentence>",
    "notes": "<one sentence>"
  },
  "vc_method": {
    "projected_exit_revenue_usd": <number|null>,
    "exit_multiple": <number|null>,
    "years_to_exit": <3-10|null>,
    "target_irr_pct": <15-40|null>,
    "current_ownership_pct": <0-100|null>,
    "notes": "<one sentence>"
  },
  "dcf": {
    "year1_revenue_usd": <number|null>,
    "revenue_growth_pct": <number|null>,
    "ebitda_margin_pct": <number|null>,
    "capex_pct_revenue": <number|null>,
    "tax_rate_pct": <21|null>,
    "terminal_growth_pct": <2-4|null>,
    "wacc_pct": <8-20|null>,
    "notes": "<one sentence>"
  },
  "option_pricing": {
    "enterprise_value_usd": <number|null>,
    "total_preferred_liquidation_pref_usd": <number|null>,
    "volatility_pct": <30-90|null>,
    "time_to_liquidity_years": <2-6|null>,
    "risk_free_rate_pct": <2-5|null>,
    "common_share_pct": <null>,
    "notes": "<one sentence — flag if cap table would improve this>"
  },
  "narrative": "<2-4 sentence overall commentary on which methods you trust most for this target and why>"
}

Rules:
- NEVER invent numbers not defensible from the evidence. Prefer null over a guess.
- For dcf.wacc_pct, use 10-14% for mature SaaS, 15-18% for growth-stage, 18-22% for early-stage/deeptech.
- For terminal_growth_pct, stay 2-4% (long-run US GDP proxy).
- For target_irr_pct, use 25-30% for typical VC portfolios, 35-40% for seed/pre-seed.
- Every non-null number must be defensible from the provided web evidence."""


async def autofill_workbench(
    *,
    company_name: str,
    sector: str | None,
    one_liner: str | None,
    estimated_revenue: str | None,
    headquarters: str | None,
    brave_fn: Callable[[str, int], Awaitable[list[dict]]],
    perplexity_fn: Callable[[str], Awaitable[dict]],
    claude_fn: Callable[[str, str], Awaitable[str]],
    safe_json: Callable[[str], dict],
) -> dict:
    """Return `{inputs:{5 methods}, narrative, sources[]}` seeded from the web."""
    import asyncio
    tx_query = f"{company_name} latest funding round Series post-money valuation date raised"
    mm_query = f"{company_name} revenue ARR employees comparable public companies stock ticker"
    fin_query = f"{company_name} EBITDA margin growth rate financial performance"
    px_prompt = (
        f"Provide a factual valuation-analyst briefing on {company_name}"
        + (f" (sector: {sector})" if sector else "")
        + ": (1) most recent priced financing round with amount raised, post-money valuation, date, "
        f"and series; (2) revenue/ARR signals, growth trajectory, and estimated EBITDA margin; "
        f"(3) 3-5 publicly traded comparable companies with tickers; (4) any known preferred stock "
        f"or capital structure details; (5) reasonable exit horizon and expected exit multiple for "
        f"this stage/sector. Cite every claim. Say 'not disclosed' if unavailable."
    )
    brave_tx, brave_mm, brave_fin, px = await asyncio.gather(
        brave_fn(tx_query, 8),
        brave_fn(mm_query, 6),
        brave_fn(fin_query, 4),
        perplexity_fn(px_prompt),
        return_exceptions=True,
    )
    brave_tx = brave_tx if isinstance(brave_tx, list) else []
    brave_mm = brave_mm if isinstance(brave_mm, list) else []
    brave_fin = brave_fin if isinstance(brave_fin, list) else []
    px = px if isinstance(px, dict) else {"text": "", "citations": []}

    lines: list[str] = [f"COMPANY: {company_name}"]
    if one_liner: lines.append(f"ONE-LINER: {one_liner}")
    if sector: lines.append(f"SECTOR: {sector}")
    if headquarters: lines.append(f"HQ: {headquarters}")
    if estimated_revenue: lines.append(f"REVENUE HINT: {estimated_revenue}")
    lines.append("")
    lines.append("PERPLEXITY BRIEFING:")
    lines.append((px.get("text") or "").strip()[:3500] or "(no briefing)")
    lines.append("")
    for label, hits in [
        ("RECENT TRANSACTION SIGNALS", brave_tx[:8]),
        ("REVENUE / COMPARABLE SIGNALS", brave_mm[:6]),
        ("FINANCIAL PERFORMANCE SIGNALS", brave_fin[:4]),
    ]:
        lines.append(f"WEB SEARCH — {label}:")
        for h in hits:
            lines.append(f"- [{(h.get('title') or '')[:120]}] {h.get('url', '')}\n  {(h.get('snippet') or '')[:280]}")
        lines.append("")
    lines.append(f"MEASUREMENT DATE: {datetime.now(timezone.utc).isoformat()}")

    try:
        raw = await claude_fn(_AUTOFILL_SYSTEM, "\n".join(lines))
    except Exception as e:
        logger.warning(f"autofill_workbench claude failed: {e}")
        return _empty_workbench_seed(str(e))

    parsed = safe_json(raw) or {}
    if not any(k in parsed for k in ("recent_transaction", "market_multiples", "dcf")):
        return _empty_workbench_seed("model returned no method inputs")

    return {
        "inputs": {
            "recent_transaction": parsed.get("recent_transaction") or {},
            "market_multiples":   parsed.get("market_multiples")   or {},
            "vc_method":          parsed.get("vc_method")          or {},
            "dcf":                parsed.get("dcf")                or {},
            "option_pricing":     parsed.get("option_pricing")     or {},
        },
        "narrative": parsed.get("narrative") or "",
        "sources": _merge_sources(px, brave_tx, brave_mm, brave_fin),
    }


# --------------------------------------------------------------------------- #
# TERM-SHEET EXTRACTION — Claude reads an uploaded PDF and populates
# recent_transaction + option_pricing inputs from the extracted round terms.
# --------------------------------------------------------------------------- #
_TERM_SHEET_SYSTEM = """You are an expert reading a private-company TERM SHEET or 409A valuation. From the raw text provided, extract structured round terms and cap-table details.

Return STRICT JSON only:
{
  "round_type": "Seed|Series A|Series B|...|null",
  "price_per_share_usd": <number|null>,
  "raised_usd": <number|null>,
  "pre_money_usd": <number|null>,
  "post_money_usd": <number|null>,
  "announced": "<YYYY-MM|null>",
  "total_preferred_liquidation_pref_usd": <number|null>,
  "liquidation_multiple": <1|2|3|null>,
  "participation": "non-participating|full-participating|capped|null",
  "dividend_rate_pct": <number|null>,
  "confidence": "high|medium|low",
  "notes": "<one to two sentences on data quality>"
}

If a field is not clearly stated, return null. Do not invent."""


async def extract_term_sheet(
    *,
    pdf_text: str,
    claude_fn: Callable[[str, str], Awaitable[str]],
    safe_json: Callable[[str], dict],
) -> dict:
    """Given extracted text from a term sheet PDF, return structured round terms."""
    if not (pdf_text or "").strip():
        return {"confidence": "low", "notes": "Empty PDF text.", "error": "no_text"}
    # Truncate to keep prompt cost bounded — 20k chars is enough for most term sheets.
    trimmed = pdf_text[:20000]
    try:
        raw = await claude_fn(_TERM_SHEET_SYSTEM, f"TERM SHEET TEXT:\n\n{trimmed}")
    except Exception as e:
        return {"confidence": "low", "notes": f"Extraction failed: {e}", "error": "claude"}
    parsed = safe_json(raw) or {}
    parsed.setdefault("confidence", "low")
    return parsed


# --------------------------------------------------------------------------- #
# HELPERS
# --------------------------------------------------------------------------- #
def _num(x: Any) -> float | None:
    if x is None or x == "":
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _fmt(n: float | int | None) -> str:
    if n is None:
        return "—"
    n = float(n)
    if abs(n) >= 1e9:
        return f"${n / 1e9:.1f}B"
    if abs(n) >= 1e6:
        return f"${n / 1e6:.1f}M"
    if abs(n) >= 1e3:
        return f"${n / 1e3:.0f}K"
    return f"${n:.0f}"


def _merge_sources(px: dict, *brave_lists) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for url in (px.get("citations") or []):
        if not url or url in seen:
            continue
        seen.add(url)
        out.append({"url": url, "title": "", "provider": "perplexity"})
    for lst in brave_lists:
        for hit in (lst or []):
            u = hit.get("url")
            if not u or u in seen:
                continue
            seen.add(u)
            out.append({
                "url": u,
                "title": (hit.get("title") or "")[:140],
                "snippet": (hit.get("snippet") or "")[:220],
                "provider": "brave",
            })
    return out[:30]


def _empty_workbench_seed(reason: str) -> dict:
    return {
        "inputs": {k: {} for k in ("recent_transaction", "market_multiples", "vc_method", "dcf", "option_pricing")},
        "narrative": f"Autofill unavailable: {reason}. Enter inputs manually.",
        "sources": [],
    }
