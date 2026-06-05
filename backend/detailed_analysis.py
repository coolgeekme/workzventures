"""Detailed Company Analysis — Phase 1 ("Standard" Kenshin-style report).

Produces a structured 14-section JSON report grounded in Perplexity Sonar +
Brave search + recent news. Reuses the platform's existing Claude/Brave/
Perplexity wrappers via dependency injection so this module stays testable
and does not duplicate API keys or HTTP clients.

Sections (mirrors `ReportData` from the source repo, trimmed to what's
deliverable in a single Claude pass):
  1. executiveSummary
  2. companyOverview
  3. marketAnalysis
  4. competitiveLandscape
  5. financialAnalysis
  6. managementTeam
  7. technologyIP
  8. riskAssessment
  9. complianceAndLegal
 10. dueDiligenceQuestions
 11. valuation
 12. metrics (with source URLs)
 13. keyStrengths, keyRisks
 14. strategicRecommendations
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


DETAILED_ANALYSIS_SYS = """You are an institutional M&A research analyst producing a *Detailed Company Analysis* used by accredited buyers/investors. The buyer will rely on this for an investment decision, so be specific, factual, and cite sources inline as `[n]` matching the SOURCES list. If a metric is not in the provided live evidence, mark it as `"Not publicly disclosed"` or `"Unknown"` — never invent numbers.

Return STRICT JSON ONLY in this exact shape:

{
  "executiveSummary": {
    "investmentThesis": str,                       // 2-4 sentences
    "recommendation": "strong-buy"|"buy"|"hold"|"pass",
    "keyMetrics": {
      "valuation": str, "revenue": str, "growth": str, "employees": str
    },
    "headline": str                                // a one-line takeaway
  },
  "companyOverview": {
    "description": str,
    "businessModel": str,
    "valueProposition": str,
    "targetMarket": str,
    "revenueModel": str,
    "geographicPresence": str,
    "foundedYear": str,
    "founders": [str],
    "headquarters": str,
    "productOffering": str,
    "customerBase": str,
    "productMarketFit": str
  },
  "marketAnalysis": {
    "tam": str, "sam": str, "marketGrowthRate": str,
    "marketSize": str, "regulatoryEnvironment": str
  },
  "competitiveLandscape": {
    "directCompetitors": [str],
    "indirectCompetitors": [str],
    "competitiveAdvantages": [str],
    "marketPositioning": str,
    "competitiveMoat": str,
    "marketShare": str,
    "switchingCosts": str,
    "threats": [str]
  },
  "financialAnalysis": {
    "revenueGrowth": str,
    "profitabilityMetrics": str,
    "burnRate": str,
    "fundingHistory": str,
    "projections": str
  },
  "managementTeam": {
    "founderBackground": str,
    "executiveTeam": str,
    "boardComposition": str,
    "teamGaps": str
  },
  "technologyIP": {
    "technologyStack": str,
    "ipPortfolio": str,
    "patents": str,
    "rdCapabilities": str
  },
  "riskAssessment": {
    "marketRisks": [str],
    "operationalRisks": [str],
    "financialRisks": [str],
    "technologyRisks": [str],
    "regulatoryRisks": [str]
  },
  "complianceAndLegal": {
    "regulatoryViolations": str,
    "internationalCompliance": str,
    "legalProceedings": str,
    "executiveBackgrounds": str,
    "complianceStatus": str
  },
  "dueDiligenceQuestions": {
    "financial": [str], "market": [str], "technology": [str],
    "team": [str], "legal": [str]
  },
  "valuation": {
    "currentValuation": str,
    "comparableAnalysis": str,
    "fairValueRange": str,
    "methodology": str
  },
  "metrics": {
    "revenue": str, "revenueSourceUrl": str,
    "growth": str, "growthSourceUrl": str,
    "employees": str, "employeesSourceUrl": str,
    "countries": str, "countriesSourceUrl": str,
    "valuation": str, "valuationSourceUrl": str
  },
  "keyStrengths": [str],          // 4-6 bullets
  "keyRisks": [str],              // 4-6 bullets
  "strategicRecommendations": [str]  // 3-5 actionable next steps for the buyer
}

Rules:
- Inline-cite every factual claim as [n] referencing the SOURCES list.
- For each *SourceUrl* in metrics, place the actual URL from SOURCES, or "" if unknown.
- recommendation must be one of: strong-buy | buy | hold | pass.
- Return JSON only — no prose, no markdown fences.
"""


def _safe_json(raw: str) -> Optional[Dict[str, Any]]:
    """Best-effort JSON extractor — tolerates code fences and stray prose."""
    if not raw:
        return None
    # strip ``` fences if present
    fenced = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", raw)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except Exception:
            pass
    # first balanced { ... }
    match = re.search(r"\{[\s\S]*\}", raw)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except Exception:
        try:
            return json.loads(re.sub(r",\s*([}\]])", r"\1", match.group(0)))
        except Exception:
            return None


def _build_sources(perp_citations: List[str], brave_hits: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    idx = 0
    for url in perp_citations or []:
        if not url or url in seen:
            continue
        seen.add(url)
        idx += 1
        out.append({"index": idx, "url": url, "title": "", "provider": "perplexity", "snippet": ""})
    for hit in brave_hits or []:
        url = hit.get("url")
        if not url or url in seen:
            continue
        seen.add(url)
        idx += 1
        out.append({
            "index": idx, "url": url,
            "title": (hit.get("title") or "")[:160],
            "snippet": (hit.get("description") or hit.get("snippet") or "")[:280],
            "provider": "brave",
        })
    return out[:40]


async def run_detailed_analysis(
    *,
    call_claude: Callable[..., Awaitable[str]],
    query_perplexity: Callable[..., Awaitable[Dict[str, Any]]],
    search_brave: Callable[..., Awaitable[List[Dict[str, Any]]]],
    company_name: str,
    company_url: Optional[str] = None,
    industry: Optional[str] = None,
    region: Optional[str] = None,
    funding_stage: Optional[str] = None,
    buyer_notes: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Returns the full structured report dict + meta (sources, duration, etc.)."""
    started = datetime.now(timezone.utc)

    # ---- 1. Parallel evidence gathering ------------------------------------
    perplexity_prompt = (
        f"Detailed institutional company analysis: {company_name}"
        + (f" ({company_url})" if company_url else "")
        + (f", industry: {industry}" if industry else "")
        + (f", region: {region}" if region else "")
        + (f", funding stage: {funding_stage}" if funding_stage else "")
        + ". Cover: business model, revenue + growth, employee count, valuation, "
          "leadership, customers, competitors (direct + indirect), market size (TAM/SAM), "
          "regulatory environment, recent funding rounds, recent news (last 12 months), "
          "key risks. Return a thorough, source-cited summary."
    )
    brave_general = f"{company_name} {industry or ''} company overview".strip()
    brave_finance = f"{company_name} revenue funding valuation employees".strip()
    brave_news = f"{company_name} news 2026 OR 2025".strip()
    brave_competitors = f"{company_name} competitors alternatives vs".strip()

    perplexity_res, b_general, b_finance, b_news, b_compet = await asyncio.gather(
        query_perplexity(perplexity_prompt),
        search_brave(brave_general, count=6),
        search_brave(brave_finance, count=6),
        search_brave(brave_news, count=6),
        search_brave(brave_competitors, count=5),
        return_exceptions=True,
    )

    def _ok(x):
        return x if not isinstance(x, Exception) else None

    perplexity_res = _ok(perplexity_res) or {}
    brave_hits = (_ok(b_general) or []) + (_ok(b_finance) or []) + (_ok(b_news) or []) + (_ok(b_compet) or [])
    sources = _build_sources(perplexity_res.get("citations") or [], brave_hits)

    # ---- 2. Prompt Claude with the grounded context ------------------------
    sources_block = "\n".join(
        f"[{s['index']}] {s.get('title') or s['url']} — {s['url']}"
        + (f" :: {s['snippet']}" if s.get("snippet") else "")
        for s in sources
    ) or "(no live sources available — proceed with model knowledge but mark as unverified)"

    perp_summary = (perplexity_res.get("text") or "").strip()
    grounded_user = (
        f"COMPANY: {company_name}\n"
        f"WEBSITE: {company_url or 'unknown'}\n"
        f"INDUSTRY HINT: {industry or 'unspecified'}\n"
        f"REGION HINT: {region or 'global'}\n"
        f"FUNDING STAGE: {funding_stage or 'unspecified'}\n"
        f"BUYER NOTES: {buyer_notes or 'none'}\n\n"
        f"LIVE WEB RESEARCH SUMMARY (from Perplexity Sonar):\n{perp_summary or '(none — proceed cautiously)'}\n\n"
        f"SOURCES (cite as [n] inline; the *SourceUrl* fields should reference these URLs):\n{sources_block}\n\n"
        "Produce the full structured JSON report now. Be specific, source everything, "
        "and never invent metrics — write 'Not publicly disclosed' where data is missing."
    )

    raw = await call_claude(
        DETAILED_ANALYSIS_SYS,
        grounded_user,
        session_id=f"detailed-{user_id or 'anon'}-{company_name[:20]}",
    )
    data = _safe_json(raw)
    if not data:
        raise RuntimeError("Claude returned an unparseable response for detailed analysis")

    # ---- 3. Defensive structure (ensure every section key exists) ----------
    defaults = {
        "executiveSummary": {"investmentThesis": "", "recommendation": "hold",
                              "keyMetrics": {"valuation": "Unknown", "revenue": "Unknown",
                                             "growth": "Unknown", "employees": "Unknown"},
                              "headline": ""},
        "companyOverview": {}, "marketAnalysis": {}, "competitiveLandscape": {},
        "financialAnalysis": {}, "managementTeam": {}, "technologyIP": {},
        "riskAssessment": {"marketRisks": [], "operationalRisks": [], "financialRisks": [],
                            "technologyRisks": [], "regulatoryRisks": []},
        "complianceAndLegal": {}, "dueDiligenceQuestions": {"financial": [], "market": [],
                                                              "technology": [], "team": [], "legal": []},
        "valuation": {}, "metrics": {},
        "keyStrengths": [], "keyRisks": [], "strategicRecommendations": [],
    }
    for k, v in defaults.items():
        if k not in data or data.get(k) in (None, "", [], {}):
            data[k] = v
        elif isinstance(v, dict):
            for inner_k, inner_v in v.items():
                data[k].setdefault(inner_k, inner_v)

    # Normalize recommendation enum
    rec = (data.get("executiveSummary") or {}).get("recommendation", "hold").lower().replace(" ", "-")
    if rec not in ("strong-buy", "buy", "hold", "pass"):
        rec = "hold"
    data["executiveSummary"]["recommendation"] = rec

    duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    return {
        "company_name": company_name,
        "company_url": company_url,
        "industry": industry,
        "region": region,
        "funding_stage": funding_stage,
        "data": data,
        "sources": sources,
        "perplexity_summary": perp_summary[:8000] if perp_summary else "",
        "live_research_used": bool(perp_summary or brave_hits),
        "source_count": len(sources),
        "duration_ms": duration_ms,
        "generated_at": started.isoformat(),
    }
