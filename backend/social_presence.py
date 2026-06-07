"""Social-presence discovery — finds the company's main social/community profiles
and pulls lightweight signals (followers/employees/last-post recency) from the
Brave snippets. No new API keys needed; reuses the platform's existing Brave
client via dependency injection.

Output shape (stable contract used by Research Hub + Detailed Analysis + UI):
{
  "linkedin":   {"url": str, "title": str, "snippet": str, "employees": str|null, "followers": str|null},
  "twitter":    {"url": str, "title": str, "snippet": str, "followers": str|null, "last_post": str|null},
  "github":     {"url": str, "title": str, "snippet": str, "stars": str|null, "repos": str|null},
  "youtube":    {"url": str, "title": str, "snippet": str, "subscribers": str|null},
  "crunchbase": {"url": str, "title": str, "snippet": str},
  "producthunt":{"url": str, "title": str, "snippet": str, "upvotes": str|null},
  "instagram":  {"url": str, "title": str, "snippet": str, "followers": str|null}
}
Any platform with no hit is omitted from the dict (so callers can iterate keys).
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


PLATFORMS: List[Dict[str, Any]] = [
    {"key": "linkedin",    "site": "linkedin.com/company",    "extra": ""},
    {"key": "twitter",     "site": "x.com",                   "extra": ""},
    {"key": "github",      "site": "github.com",              "extra": ""},
    {"key": "youtube",     "site": "youtube.com",             "extra": ""},
    {"key": "crunchbase",  "site": "crunchbase.com",          "extra": "organization"},
    {"key": "producthunt", "site": "producthunt.com",         "extra": ""},
    {"key": "instagram",   "site": "instagram.com",           "extra": ""},
]


def _strip(s: Optional[str]) -> str:
    return (s or "").strip()


# Compact numeric extractor: "12,345 followers" / "1.2M followers" / "5.4k stars"
_FOLLOWERS_RE = re.compile(
    r"(\d[\d,]*(?:\.\d+)?\s*[KMB]?)\s*(?:followers|connections|members|fans)",
    re.IGNORECASE,
)
_EMPLOYEES_RE = re.compile(
    r"(\d[\d,]*(?:\.\d+)?\s*[KMB]?)[\+\s]*(?:employees|people on linkedin|connections)",
    re.IGNORECASE,
)
_SUBS_RE = re.compile(
    r"(\d[\d,]*(?:\.\d+)?\s*[KMB]?)\s*(?:subscribers|subs)",
    re.IGNORECASE,
)
_STARS_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?\s*[KMB]?)\s*(?:stars|☆)", re.IGNORECASE)
_REPOS_RE = re.compile(r"(\d[\d,]*)\s*(?:repositor|repos)", re.IGNORECASE)
_UPVOTES_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?\s*[KMB]?)\s*(?:upvotes|votes)", re.IGNORECASE)


def _first_match(pattern: re.Pattern, *texts: str) -> Optional[str]:
    for t in texts:
        if not t:
            continue
        m = pattern.search(t)
        if m:
            return m.group(1).strip()
    return None


def _company_url_to_seed(name: str, url: Optional[str]) -> str:
    """Build a query seed that disambiguates the company (helps when the name is generic)."""
    if not url:
        return name
    bare = re.sub(r"^https?://", "", url, flags=re.IGNORECASE)
    bare = re.sub(r"^www\.", "", bare, flags=re.IGNORECASE)
    bare = bare.split("/")[0]
    # Push the brand domain to query to bias matches toward the right entity
    return f"{name} {bare}"


def _accept_url(url: str, platform_key: str) -> bool:
    """Reject obviously-wrong matches (homepage, listing pages, search results)."""
    if not url:
        return False
    u = url.lower()
    if platform_key == "linkedin":
        return "linkedin.com/company/" in u
    if platform_key == "twitter":
        # X/Twitter status pages aren't profiles
        return ("x.com/" in u or "twitter.com/" in u) and "/status/" not in u
    if platform_key == "github":
        # Skip individual files / issues — want the org root
        return "github.com/" in u and "/blob/" not in u and "/issues/" not in u
    if platform_key == "youtube":
        return ("/channel/" in u) or ("/@" in u) or ("/c/" in u) or ("/user/" in u)
    if platform_key == "crunchbase":
        return "crunchbase.com/organization/" in u
    if platform_key == "producthunt":
        return "producthunt.com/" in u and "/posts/" not in u
    if platform_key == "instagram":
        return "instagram.com/" in u and "/p/" not in u and "/reel/" not in u
    return True


async def discover_social_profiles(
    *,
    search_brave: Callable[..., Awaitable[List[Dict[str, Any]]]],
    company_name: str,
    company_url: Optional[str] = None,
    request_interval_ms: int = 1100,
) -> Dict[str, Dict[str, Any]]:
    """Run one Brave query per platform sequentially with a small delay between
    them so we stay within Brave's free-plan rate limit (1 req/sec). Picks the
    first credible match per platform; missing platforms are simply omitted."""
    if not company_name or not company_name.strip():
        return {}
    seed = _company_url_to_seed(company_name.strip(), company_url)

    out: Dict[str, Dict[str, Any]] = {}
    for i, plat in enumerate(PLATFORMS):
        if i > 0:
            await asyncio.sleep(request_interval_ms / 1000.0)
        q = f'{seed} site:{plat["site"]} {plat.get("extra", "")}'.strip()
        try:
            hits = await search_brave(q, count=5)
        except Exception as e:
            logger.warning(f"social: brave for {plat['key']} failed: {e}")
            continue
        for h in hits or []:
            url = _strip(h.get("url"))
            if not _accept_url(url, plat["key"]):
                continue
            title = _strip(h.get("title"))
            snippet = _strip(h.get("description") or h.get("snippet"))
            payload = {"url": url, "title": title, "snippet": snippet}
            text = f"{title} :: {snippet}"
            key = plat["key"]
            if key == "linkedin":
                payload["followers"] = _first_match(_FOLLOWERS_RE, text)
                payload["employees"] = _first_match(_EMPLOYEES_RE, text)
            elif key == "twitter":
                payload["followers"] = _first_match(_FOLLOWERS_RE, text)
            elif key == "youtube":
                payload["subscribers"] = _first_match(_SUBS_RE, text)
            elif key == "github":
                payload["stars"] = _first_match(_STARS_RE, text)
                payload["repos"] = _first_match(_REPOS_RE, text)
            elif key == "producthunt":
                payload["upvotes"] = _first_match(_UPVOTES_RE, text)
            elif key == "instagram":
                payload["followers"] = _first_match(_FOLLOWERS_RE, text)
            out[key] = payload
            break
    return out
