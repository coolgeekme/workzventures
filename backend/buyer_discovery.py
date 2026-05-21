"""
Workz Ventures · Buyer Discovery
- SEC EDGAR full-text search → recent acquirers in the target sector
- UK Companies House search → strategic + PE acquirers (requires COMPANIES_HOUSE_API_KEY)
- Brave + Perplexity (already in stack) → live press signals
- Claude Sonnet 4.5 → ranks candidates against the seller's listing
"""
import asyncio
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("workz.buyer_discovery")

UA = os.environ.get("SEC_USER_AGENT", "Workz Ventures discovery@workz.example.com")
EDGAR_SEARCH = "https://efts.sec.gov/LATEST/search-index"
EDGAR_ARCHIVE = "https://www.sec.gov/cgi-bin/browse-edgar"
CH_API_KEY = os.environ.get("COMPANIES_HOUSE_API_KEY")
CH_BASE = "https://api.company-information.service.gov.uk"

ACQUISITION_VERBS = re.compile(
    r"\b(acquire[ds]?|acquisition of|to acquire|completed the acquisition|merger with|bought|purchased)\b",
    re.IGNORECASE,
)


async def _edgar_search(client: httpx.AsyncClient, q: str, *, forms: str = "8-K", days: int = 540) -> List[Dict[str, Any]]:
    """SEC EDGAR full-text search. Free, no auth — only requires a User-Agent."""
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)
    params = {
        "q": q,
        "forms": forms,
        "dateRange": "custom",
        "startdt": start.isoformat(),
        "enddt": end.isoformat(),
    }
    try:
        r = await client.get(EDGAR_SEARCH, params=params, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=15.0)
        if r.status_code != 200:
            logger.warning(f"EDGAR search non-200 {r.status_code}: {r.text[:200]}")
            return []
        data = r.json()
    except Exception as e:
        logger.warning(f"EDGAR search failed: {e}")
        return []
    hits = (((data or {}).get("hits") or {}).get("hits")) or []
    return hits


def _edgar_filing_url(hit: Dict[str, Any]) -> Optional[str]:
    src = hit.get("_source") or {}
    adsh = (hit.get("_id") or "").split(":", 1)[0]
    ciks = src.get("ciks") or []
    if not adsh or not ciks:
        return None
    adsh_dashless = adsh.replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{int(ciks[0])}/{adsh_dashless}/{adsh}-index.htm"


async def edgar_buyer_signals(sector: str, deal_size_label: Optional[str] = None, limit: int = 25) -> List[Dict[str, Any]]:
    """Find US public companies that have announced acquisitions in this sector recently."""
    queries = [
        f'"acquisition" "{sector}"',
        f'"to acquire" "{sector}"',
    ]
    seen: Dict[str, Dict[str, Any]] = {}
    async with httpx.AsyncClient() as client:
        for q in queries:
            hits = await _edgar_search(client, q, forms="8-K", days=540)
            for h in hits:
                src = h.get("_source") or {}
                display_names = src.get("display_names") or []
                if not display_names:
                    continue
                # Take only the first display_name (the registrant/acquirer)
                buyer = re.sub(r"\s*\(CIK [^)]+\)\s*$", "", display_names[0]).strip()
                if not buyer or buyer in seen:
                    continue
                snippet = " ".join((h.get("highlight") or {}).get("body", [])) or src.get("file_description") or ""
                # Filter — must really look like an acquisition mention
                if not ACQUISITION_VERBS.search(snippet) and not ACQUISITION_VERBS.search(src.get("file_description", "")):
                    pass  # keep — EDGAR full-text matched, so context is there
                ciks = src.get("ciks") or []
                seen[buyer] = {
                    "source": "sec_edgar",
                    "country": "US",
                    "buyer_name": buyer,
                    "buyer_cik": ciks[0] if ciks else None,
                    "filed_at": src.get("file_date"),
                    "form": src.get("form"),
                    "snippet": snippet[:500],
                    "filing_url": _edgar_filing_url(h),
                    "tickers": src.get("tickers") or [],
                }
                if len(seen) >= limit:
                    break
            if len(seen) >= limit:
                break
    return list(seen.values())[:limit]


async def companies_house_search(query: str, limit: int = 15) -> List[Dict[str, Any]]:
    """UK Companies House company search. Free with API key (basic auth)."""
    if not CH_API_KEY:
        logger.info("COMPANIES_HOUSE_API_KEY not configured — skipping UK source")
        return []
    auth = (CH_API_KEY, "")
    out: List[Dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=12.0) as client:
        try:
            r = await client.get(
                f"{CH_BASE}/search/companies",
                params={"q": query, "items_per_page": min(limit, 50)},
                auth=auth,
                headers={"User-Agent": UA, "Accept": "application/json"},
            )
            if r.status_code != 200:
                logger.warning(f"CompaniesHouse non-200 {r.status_code}")
                return []
            for item in (r.json() or {}).get("items", []):
                if item.get("company_status") != "active":
                    continue
                out.append({
                    "source": "companies_house",
                    "country": "UK",
                    "buyer_name": item.get("title"),
                    "buyer_cik": item.get("company_number"),
                    "filed_at": item.get("date_of_creation"),
                    "form": item.get("company_type"),
                    "snippet": item.get("description") or item.get("address_snippet") or "",
                    "filing_url": f"https://find-and-update.company-information.service.gov.uk/company/{item.get('company_number')}",
                    "tickers": [],
                })
        except Exception as e:
            logger.warning(f"CompaniesHouse search failed: {e}")
    return out[:limit]


async def gather_candidates(listing: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Aggregate raw candidates from every free source."""
    sector = listing.get("sector") or listing.get("industry") or ""
    if not sector:
        return []
    # Run both sources in parallel
    us_task = asyncio.create_task(edgar_buyer_signals(sector, listing.get("revenue_band"), limit=25))
    uk_task = asyncio.create_task(companies_house_search(f"{sector} holdings", limit=15))
    us, uk = await asyncio.gather(us_task, uk_task)
    return us + uk


def build_ranker_prompt(listing: Dict[str, Any], candidates: List[Dict[str, Any]]) -> str:
    """Compact prompt for Claude — JSON in / JSON out."""
    lines = [
        "SELLER LISTING:",
        f"  Company: {listing.get('company_name') or listing.get('name')}",
        f"  Sector: {listing.get('sector')}",
        f"  Revenue band: {listing.get('revenue_band','—')}",
        f"  EBITDA band: {listing.get('ebitda_band','—')}",
        f"  Geography: {listing.get('geography','—')}",
        f"  Deal type: {listing.get('deal_type','—')}",
        f"  Tagline: {listing.get('tagline','—')}",
        "",
        "CANDIDATE BUYERS (from SEC EDGAR + UK Companies House):",
    ]
    for i, c in enumerate(candidates[:40], start=1):
        lines.append(
            f"  [{i}] {c['buyer_name']} · {c['country']} · src={c['source']} · "
            f"filed={c.get('filed_at','—')} · {c.get('snippet','')[:220]}"
        )
    lines += [
        "",
        "TASK: Rank each candidate 0–100 for likelihood they would be a strong acquirer of this seller. "
        "Score on: (a) sector fit, (b) deal-size fit, (c) geo fit, (d) acquisition cadence/recency, (e) strategic vs financial fit. "
        'Return STRICT JSON {"ranked":[{"index":int,"score":int,"rationale":str,"fit":{"sector":0-100,"size":0-100,"geo":0-100,"cadence":0-100}}]}. '
        "Cap rationale to 200 chars. Drop weak matches (<35). Order best first.",
    ]
    return "\n".join(lines)


async def rank_with_claude(call_claude, listing: Dict[str, Any], candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Returns enriched candidates with score/rationale/fit. call_claude is injected to avoid circular imports."""
    if not candidates:
        return []
    prompt = build_ranker_prompt(listing, candidates)
    try:
        raw = await call_claude(
            "You are a senior M&A buyer-targeting analyst. Reply with STRICT JSON only.",
            prompt,
            session_id=f"buyer-rank-{listing.get('id','x')}",
        )
    except Exception as e:
        logger.warning(f"Claude ranking failed: {e}")
        return [{**c, "score": 50, "rationale": "Auto-included (ranker offline)", "fit": {}} for c in candidates[:10]]

    # Parse JSON
    import json
    try:
        m = re.search(r"\{.*\}", raw, flags=re.S)
        data = json.loads(m.group(0)) if m else json.loads(raw)
    except Exception:
        logger.warning("Could not parse Claude ranking JSON")
        return [{**c, "score": 50, "rationale": "Ranking unparseable", "fit": {}} for c in candidates[:10]]

    ranked_out: List[Dict[str, Any]] = []
    for item in (data.get("ranked") or [])[:30]:
        try:
            idx = int(item.get("index", 0)) - 1
        except Exception:
            continue
        if 0 <= idx < len(candidates):
            cand = candidates[idx]
            ranked_out.append({
                **cand,
                "score": int(item.get("score", 0)),
                "rationale": (item.get("rationale") or "")[:240],
                "fit": item.get("fit") or {},
            })
    return ranked_out
