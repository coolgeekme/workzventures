"""Fair-value estimation for private companies — Phase E.

Two methods, run in a single grounded pass:
  1. Recent Transaction (with time-decay)
  2. Market Multiples (public comparable tickers × estimated revenue)

Grounded on real-time web (Perplexity Sonar Pro + Brave) and reasoned by
Claude Sonnet 4.5, returning a structured JSON band {low, base, high}.

The module exposes ONE public coroutine, `estimate_valuation()`. It receives
the shared helpers (brave / perplexity / claude / json parser) as arguments
so `server.py` remains the single source of truth for API keys + LLM config.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


# Time-decay curve applied to the last priced round. A 12-month-old round
# is still meaningful, but a 3-year-old round almost certainly isn't fair
# value anymore. Numbers come from IPEV guideline heuristics.
def _time_decay_factor(months_since: float | int | None) -> float:
    if months_since is None:
        return 0.6  # unknown age → conservative middle
    m = float(months_since)
    if m < 0:
        return 1.0
    if m <= 6:
        return 1.0
    if m <= 12:
        return 0.85
    if m <= 24:
        return 0.65
    if m <= 36:
        return 0.40
    return 0.20


_SYSTEM = """You are a senior private-markets valuation analyst producing a fair-value estimate for a private company. You apply IPEV guidelines and ASC 820 principles.

You receive REAL-TIME WEB EVIDENCE (search snippets and a Perplexity briefing) and must return a strict JSON object combining two methods:
  1. Recent Transaction — pull the most recent priced financing (Series A/B/C/etc, not SAFE unless converted). Extract raised, post-money, announcement date. If only the raised amount is known, estimate post-money from typical dilution (raised ÷ 0.15 to 0.25 depending on stage). Apply the time-decay factor supplied.
  2. Market Multiples — propose 3–5 PUBLICLY TRADED comparable tickers, take their median EV/Revenue multiple (or EV/EBITDA if SaaS/hardware unclear), and multiply by an estimated annual revenue for the target. Estimate revenue from any public signals (employees, ARR mentions, press claims). If no revenue can be defended, return null.

Aggregate the two into a fair-value band:
  - base = weighted mean (Recent Transaction 60%, Multiples 40% if both present)
  - low  = min of adjusted method values × 0.8
  - high = max of adjusted method values × 1.2
  - if only one method has data, spread ±30% around it
  - if BOTH null → insufficient_data=true, still emit a heuristic $1M-$25M band with confidence="low"
  - confidence: "high" if two methods agree within 30%, "medium" within 60%, else "low"

Output STRICT JSON only, no prose:
{
  "recent_transaction": {
    "value_usd": <number|null>,
    "round_type": "<Series X|Seed|Bridge|null>",
    "raised_usd": <number|null>,
    "post_money_usd": <number|null>,
    "announced": "<YYYY-MM|null>",
    "months_since": <number|null>,
    "time_decay_factor": <0.2-1.0>,
    "adjusted_value_usd": <number|null>,
    "confidence": "high|medium|low",
    "note": "<one sentence, cite source>"
  },
  "market_multiples": {
    "value_usd": <number|null>,
    "comparable_tickers": ["TICK1","TICK2"],
    "median_multiple": <number|null>,
    "multiple_type": "EV/Revenue|EV/EBITDA|null",
    "estimated_annual_revenue_usd": <number|null>,
    "revenue_basis": "<one sentence>",
    "confidence": "high|medium|low",
    "note": "<one sentence>"
  },
  "aggregate": {
    "low_usd": <number>,
    "base_usd": <number>,
    "high_usd": <number>,
    "confidence": "high|medium|low",
    "insufficient_data": <bool>,
    "summary": "<one to two sentences justifying the band>"
  }
}

All figures USD. Do not invent numbers not defensible from the evidence."""


def _months_since_iso(iso_month: str | None) -> float | None:
    if not iso_month:
        return None
    try:
        s = iso_month.strip()
        if len(s) == 4:  # "2024"
            s = f"{s}-06"
        if len(s) == 7:  # "2024-11"
            s = f"{s}-15"
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        delta_days = (now - dt).total_seconds() / 86400
        return round(delta_days / 30.44, 1)
    except Exception:
        return None


async def estimate_valuation(
    *,
    company_name: str,
    sector: str | None = None,
    one_liner: str | None = None,
    estimated_revenue: str | None = None,
    headquarters: str | None = None,
    brave_fn: Callable[[str, int], Awaitable[list[dict]]],
    perplexity_fn: Callable[[str], Awaitable[dict]],
    claude_fn: Callable[[str, str], Awaitable[str]],
    safe_json: Callable[[str], dict],
) -> dict:
    """Return a fair-value band for `company_name` using free web sources only."""

    tag = f"{company_name}"
    if sector:
        tag += f" ({sector})"

    # Two parallel Brave queries + one Perplexity briefing.
    tx_query = f"{company_name} funding round Series valuation post-money raised announced"
    mm_query = f"{company_name} revenue employees ARR competitors public comparable companies stock ticker"
    px_prompt = (
        f"Provide a factual briefing on {tag}, focused on: (1) most recent priced financing "
        f"round — series, amount raised, post-money valuation, date; (2) revenue or ARR "
        f"signals (public claims, employee headcount as a proxy); (3) 3–5 publicly-traded "
        f"comparable companies in the same space with their tickers. Prefer sources from "
        f"Crunchbase, TechCrunch, SEC EDGAR, PitchBook News, official company announcements. "
        f"Cite every claim. If information is not available, say so explicitly."
    )

    brave_tx, brave_mm, px = await asyncio.gather(
        brave_fn(tx_query, 8),
        brave_fn(mm_query, 6),
        perplexity_fn(px_prompt),
        return_exceptions=True,
    )
    # Fail-soft: any of the three can 502 without breaking the pipeline.
    brave_tx = brave_tx if isinstance(brave_tx, list) else []
    brave_mm = brave_mm if isinstance(brave_mm, list) else []
    px = px if isinstance(px, dict) else {"text": "", "citations": []}

    # Build the evidence block. Truncate snippets so the prompt stays within
    # a comfortable input budget (~4k tokens).
    lines: list[str] = []
    lines.append(f"COMPANY: {company_name}")
    if one_liner:
        lines.append(f"ONE-LINER: {one_liner}")
    if sector:
        lines.append(f"SECTOR: {sector}")
    if headquarters:
        lines.append(f"HQ: {headquarters}")
    if estimated_revenue:
        lines.append(f"BRIEF-STATED REVENUE: {estimated_revenue}")
    lines.append("")
    lines.append("PERPLEXITY BRIEFING:")
    lines.append((px.get("text") or "").strip()[:3500] or "(no briefing returned)")
    lines.append("")
    lines.append("WEB SEARCH — RECENT TRANSACTION SIGNALS:")
    for hit in brave_tx[:8]:
        lines.append(
            f"- [{hit.get('title', '')[:120]}] {hit.get('url', '')}\n  {hit.get('snippet', '')[:280]}"
        )
    lines.append("")
    lines.append("WEB SEARCH — COMPARABLE COMPANIES / REVENUE SIGNALS:")
    for hit in brave_mm[:6]:
        lines.append(
            f"- [{hit.get('title', '')[:120]}] {hit.get('url', '')}\n  {hit.get('snippet', '')[:280]}"
        )
    lines.append("")
    lines.append(
        "TIME-DECAY REFERENCE: 0–6mo→1.0x · 6–12mo→0.85x · 12–24mo→0.65x · 24–36mo→0.40x · >36mo→0.20x"
    )
    lines.append(f"MEASUREMENT DATE: {datetime.now(timezone.utc).isoformat()}")

    user_text = "\n".join(lines)

    try:
        raw = await claude_fn(_SYSTEM, user_text)
    except Exception as e:
        logger.warning(f"valuation.claude failed for {company_name}: {e}")
        return _fallback_result(company_name, reason=str(e)[:200], sources=_merge_sources(px, brave_tx, brave_mm))

    parsed = safe_json(raw) or {}
    if "aggregate" not in parsed:
        return _fallback_result(
            company_name,
            reason="Model returned no aggregate — see raw",
            sources=_merge_sources(px, brave_tx, brave_mm),
            raw=raw,
        )

    # Post-process: recompute months_since + adjusted value from the announced
    # date if the model gave us one, so the number is provably consistent with
    # the reference table (rather than trusting the model's arithmetic).
    tx = parsed.get("recent_transaction") or {}
    announced = tx.get("announced")
    m_since = _months_since_iso(announced)
    if m_since is not None:
        tx["months_since"] = m_since
        decay = _time_decay_factor(m_since)
        tx["time_decay_factor"] = decay
        pm = tx.get("post_money_usd") or tx.get("value_usd")
        if isinstance(pm, (int, float)) and pm > 0:
            tx["adjusted_value_usd"] = round(pm * decay)
    parsed["recent_transaction"] = tx

    # Attach the deduped source list on the response so the UI can render
    # citations without a second round-trip.
    parsed["sources"] = _merge_sources(px, brave_tx, brave_mm)
    parsed["as_of"] = datetime.now(timezone.utc).isoformat()
    parsed["currency"] = "USD"
    return parsed


def _merge_sources(px: dict, *brave_lists: list[dict]) -> list[dict]:
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
    return out[:24]


def _fallback_result(company: str, *, reason: str, sources: list[dict], raw: str = "") -> dict:
    """Emit a minimal 'insufficient data' band so the UI still has something to render."""
    return {
        "recent_transaction": {"value_usd": None, "confidence": "low", "note": "No priced round found."},
        "market_multiples": {"value_usd": None, "confidence": "low", "note": "No defensible revenue signal."},
        "aggregate": {
            "low_usd": 1_000_000,
            "base_usd": 5_000_000,
            "high_usd": 25_000_000,
            "confidence": "low",
            "insufficient_data": True,
            "summary": f"Insufficient public data on {company} — showing an early-stage placeholder band. {reason}",
        },
        "sources": sources or [],
        "as_of": datetime.now(timezone.utc).isoformat(),
        "currency": "USD",
        "_debug_raw": raw[:400] if raw else "",
    }
