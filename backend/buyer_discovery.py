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
                if not ACQUISITION_VERBS.search(snippet) and not ACQUISITION_VERBS.search(src.get("file_description") or ""):
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


# -----------------------------------------------------------------------------
# Contact resolution — finds named executives + IR contacts from SEC filings
# -----------------------------------------------------------------------------
EDGAR_SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
EDGAR_ARCHIVES = "https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_dashless}/{primary}"

# Filing forms most useful for executive-officer + IR contact extraction (in priority order).
PRIORITY_FORMS = ("DEF 14A", "10-K", "10-K/A", "DEFM14A", "20-F", "8-K")

EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?1[\s\-.])?\(?\d{3}\)?[\s\-.]\d{3}[\s\-.]\d{4}(?!\d)")


def _strip_html(html: str) -> str:
    """Cheap HTML → text. Keeps paragraph breaks. Good enough for executive-section extraction."""
    if not html:
        return ""
    # Drop scripts/styles
    txt = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.IGNORECASE)
    txt = re.sub(r"<style[\s\S]*?</style>", " ", txt, flags=re.IGNORECASE)
    # Convert block tags to newlines so we keep some structure
    txt = re.sub(r"</(p|div|tr|li|h[1-6]|table)>", "\n", txt, flags=re.IGNORECASE)
    txt = re.sub(r"<br\s*/?>", "\n", txt, flags=re.IGNORECASE)
    txt = re.sub(r"<[^>]+>", " ", txt)
    # Decode common entities
    txt = (txt.replace("&nbsp;", " ").replace("&amp;", "&")
              .replace("&quot;", '"').replace("&#39;", "'")
              .replace("&lt;", "<").replace("&gt;", ">"))
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\n\s*\n+", "\n\n", txt)
    return txt.strip()


async def _edgar_get(client: httpx.AsyncClient, url: str) -> Optional[httpx.Response]:
    try:
        r = await client.get(url, headers={"User-Agent": UA, "Accept": "*/*"}, timeout=20.0)
        if r.status_code != 200:
            logger.info(f"EDGAR GET {url} → {r.status_code}")
            return None
        return r
    except Exception as e:
        logger.warning(f"EDGAR GET {url} failed: {e}")
        return None


async def fetch_company_filings(cik: str) -> Dict[str, Any]:
    """Get the most recent filings for a CIK. Returns {company_name, sic, addresses, recent_filings[]}."""
    try:
        cik_int = int(cik)
    except Exception:
        return {}
    url = EDGAR_SUBMISSIONS.format(cik=cik_int)
    async with httpx.AsyncClient() as client:
        r = await _edgar_get(client, url)
    if not r:
        return {}
    try:
        data = r.json()
    except Exception:
        return {}
    recent = ((data.get("filings") or {}).get("recent") or {})
    rows = []
    forms = recent.get("form") or []
    accs = recent.get("accessionNumber") or []
    docs = recent.get("primaryDocument") or []
    dates = recent.get("filingDate") or []
    descs = recent.get("primaryDocDescription") or []
    for i in range(min(len(forms), len(accs), len(docs))):
        rows.append({
            "form": forms[i],
            "accession": accs[i],
            "primary": docs[i],
            "filed": dates[i] if i < len(dates) else None,
            "desc": descs[i] if i < len(descs) else None,
        })
    return {
        "company_name": data.get("name"),
        "sic": data.get("sicDescription"),
        "tickers": data.get("tickers") or [],
        "addresses": data.get("addresses") or {},
        "phone": data.get("phone"),
        "former_names": [(f or {}).get("name") for f in (data.get("formerNames") or [])],
        "investor_website": (data.get("website") or "").strip(),
        "recent_filings": rows,
        "cik_int": cik_int,
    }


def _pick_best_filings(rows: List[Dict[str, Any]], *, n_per_form: int = 1) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen_forms: Dict[str, int] = {}
    for row in rows:
        f = (row.get("form") or "").upper()
        if f not in PRIORITY_FORMS:
            continue
        if seen_forms.get(f, 0) >= n_per_form:
            continue
        seen_forms[f] = seen_forms.get(f, 0) + 1
        out.append(row)
        if len(out) >= 4:
            break
    return out


async def fetch_filing_text(cik_int: int, accession: str, primary: str) -> str:
    if not (cik_int and accession and primary):
        return ""
    acc_dashless = accession.replace("-", "")
    url = EDGAR_ARCHIVES.format(cik_int=cik_int, acc_dashless=acc_dashless, primary=primary)
    async with httpx.AsyncClient() as client:
        r = await _edgar_get(client, url)
    if not r:
        return ""
    ct = (r.headers.get("content-type") or "").lower()
    body = r.text or ""
    if "html" in ct or "<html" in body[:1000].lower():
        body = _strip_html(body)
    return body[:120_000]  # cap to keep Claude prompt sane


CONTACT_EXTRACTION_SYS = """You are an M&A research analyst extracting **decision-maker contact intel** from an SEC filing.
Focus tightly on executives who would actually evaluate or approve an acquisition: 
- CEO, CFO, COO, Chief Strategy Officer
- Head of Corporate Development / M&A / Business Development
- General Counsel (legal sign-off)
- Investor Relations contact (gateway to corp dev team)

ALSO surface any contact info that literally appears in the filing text:
- IR phone numbers, IR/general email addresses (DO NOT FABRICATE — only what literally appears)
- HQ mailing address if present

Return STRICT JSON ONLY:
{
  "executives": [
    {"name": str, "title": str, "relevance": "ceo|cfo|coo|corp_dev|strategy|legal|ir|other", 
     "rationale": "<=120 chars why they matter for an acquisition", "source_excerpt": "<=240 chars from filing"}
  ],
  "ir_contact": {"name": str|null, "email": str|null, "phone": str|null},
  "general_contacts": {"emails": [str], "phones": [str], "address": str|null}
}

Rules:
- ONLY include emails/phones that literally appear in the supplied text. Never invent.
- Cap to the 8 most-relevant executives. Order by acquisition relevance (corp_dev > strategy > cfo > ceo > legal > ir > other).
- relevance must be one of the enum values.
- If you cannot find an explicit "Head of Corporate Development" or similar, leave that bucket empty rather than guessing.
"""


async def extract_contacts_with_claude(call_claude, company_name: str, filing_form: str, filing_text: str) -> Dict[str, Any]:
    if not filing_text:
        return {"executives": [], "ir_contact": {}, "general_contacts": {}}
    prompt = (
        f"COMPANY: {company_name}\n"
        f"FILING: {filing_form}\n\n"
        f"FILING TEXT (truncated):\n{filing_text[:90_000]}\n\n"
        "Extract executives and contact info per the schema. JSON only."
    )
    try:
        raw = await call_claude(CONTACT_EXTRACTION_SYS, prompt, session_id=f"contact-{company_name[:20]}")
    except Exception as e:
        logger.warning(f"Claude contact extraction failed: {e}")
        return {"executives": [], "ir_contact": {}, "general_contacts": {}}
    import json as _json
    try:
        m = re.search(r"\{[\s\S]*\}", raw)
        data = _json.loads(m.group(0)) if m else _json.loads(raw)
    except Exception:
        logger.warning("Could not parse contact-extraction JSON")
        return {"executives": [], "ir_contact": {}, "general_contacts": {}}

    # Hard sanitize: only allow emails/phones that literally appear in the source text
    found_emails = set(m.group(0).lower() for m in EMAIL_RE.finditer(filing_text))
    found_phones_raw = [m.group(0) for m in PHONE_RE.finditer(filing_text)]
    found_phones_norm = set(re.sub(r"\D", "", p)[-10:] for p in found_phones_raw if len(re.sub(r"\D", "", p)) >= 10)

    def _phone_ok(p: Optional[str]) -> bool:
        if not p:
            return False
        digits = re.sub(r"\D", "", p)[-10:]
        return digits in found_phones_norm

    def _email_ok(e: Optional[str]) -> bool:
        return bool(e) and e.lower() in found_emails

    ir = data.get("ir_contact") or {}
    ir_clean = {
        "name": (ir.get("name") or None),
        "email": ir.get("email") if _email_ok(ir.get("email")) else None,
        "phone": ir.get("phone") if _phone_ok(ir.get("phone")) else None,
    }
    gc = data.get("general_contacts") or {}
    gc_clean = {
        "emails": [e for e in (gc.get("emails") or []) if _email_ok(e)][:5],
        "phones": [p for p in (gc.get("phones") or []) if _phone_ok(p)][:5],
        "address": gc.get("address") or None,
    }

    execs = []
    for x in (data.get("executives") or [])[:8]:
        nm = (x.get("name") or "").strip()
        ti = (x.get("title") or "").strip()
        if not nm or not ti:
            continue
        execs.append({
            "name": nm,
            "title": ti,
            "relevance": x.get("relevance") or "other",
            "rationale": (x.get("rationale") or "")[:200],
            "source_excerpt": (x.get("source_excerpt") or "")[:280],
        })

    return {"executives": execs, "ir_contact": ir_clean, "general_contacts": gc_clean}


async def find_linkedin_url(search_brave_fn, name: str, company: str) -> Optional[str]:
    """One Brave query: `"{name}" {company} site:linkedin.com/in`. Returns first credible match."""
    if not name:
        return None
    q = f'"{name}" {company} site:linkedin.com/in'
    try:
        hits = await search_brave_fn(q, count=5)
    except Exception:
        return None
    for h in hits or []:
        url = (h.get("url") or "").lower()
        if "linkedin.com/in/" in url:
            return h["url"]
    return None


async def resolve_match_contacts(call_claude, search_brave_fn, *, cik: Optional[str],
                                 company_name: str) -> Dict[str, Any]:
    """End-to-end contact resolution for a buyer match. Returns dict ready to persist+display."""
    started = datetime.now(timezone.utc)
    submissions = await fetch_company_filings(cik) if cik else {}
    company_name = submissions.get("company_name") or company_name
    cik_int = submissions.get("cik_int")
    addr = (submissions.get("addresses") or {}).get("mailing") or (submissions.get("addresses") or {}).get("business") or {}
    address_lines = [v for v in [
        addr.get("street1"), addr.get("street2"),
        ", ".join([p for p in [addr.get("city"), addr.get("stateOrCountryDescription"), addr.get("zipCode")] if p]),
    ] if v]
    hq_address = "\n".join(address_lines) if address_lines else None

    picks = _pick_best_filings(submissions.get("recent_filings") or [])
    aggregated_text_parts: List[str] = []
    used_filings: List[Dict[str, Any]] = []
    for row in picks[:3]:  # cap at 3 filings to bound latency
        text = await fetch_filing_text(cik_int, row["accession"], row["primary"])
        if not text:
            continue
        # For 10-Ks, slice to Item 10 region if we can find it (drops 90%+ of irrelevant text)
        m = re.search(r"item\s*10[\.\s]+directors[\s\S]{0,40000}", text, re.IGNORECASE)
        if m:
            text = m.group(0)
        aggregated_text_parts.append(f"\n\n[FILING: {row['form']} · filed {row.get('filed')}]\n{text[:40_000]}")
        used_filings.append({
            "form": row["form"],
            "filed": row.get("filed"),
            "accession": row["accession"],
            "url": f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{row['accession'].replace('-', '')}/{row['accession']}-index.htm" if cik_int else None,
        })

    combined_text = "".join(aggregated_text_parts)[:120_000]
    extracted = await extract_contacts_with_claude(call_claude, company_name, picks[0]["form"] if picks else "n/a", combined_text)

    # LinkedIn enrichment — concurrency-limited Brave calls (one per executive)
    execs = extracted.get("executives") or []
    if execs:
        sem = asyncio.Semaphore(3)
        async def _one(ex):
            async with sem:
                try:
                    ex["linkedin_url"] = await find_linkedin_url(search_brave_fn, ex["name"], company_name)
                except Exception:
                    ex["linkedin_url"] = None
                return ex
        execs = await asyncio.gather(*[_one(e) for e in execs])

    duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    return {
        "company_name": company_name,
        "cik": cik_int,
        "hq_address": hq_address,
        "switchboard_phone": submissions.get("phone"),
        "investor_website": submissions.get("investor_website") or None,
        "ir_contact": extracted.get("ir_contact") or {},
        "general_contacts": extracted.get("general_contacts") or {},
        "executives": execs,
        "used_filings": used_filings,
        "duration_ms": duration_ms,
        "generated_at": started.isoformat(),
    }

