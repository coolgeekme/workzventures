"""
Workz Ventures - Enhanced AI-Driven Buyer & Marketing Agency
FastAPI backend with JWT auth, Claude Sonnet 4.5 research/newsletter generation,
Composio LinkedIn OAuth integration, WebMCP action registry.
"""
import os
import uuid
import json
import logging
import asyncio
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal, Dict, Any

from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Header, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pydantic import BaseModel, Field, EmailStr, ConfigDict
import bcrypt
import jwt as pyjwt
import httpx

from emergentintegrations.llm.chat import LlmChat, UserMessage

# -----------------------------------------------------------------------------
# Bootstrap
# -----------------------------------------------------------------------------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRY_HOURS = int(os.environ.get("JWT_EXPIRY_HOURS", "72"))
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
COMPOSIO_API_KEY = os.environ.get("COMPOSIO_API_KEY", "")
COMPOSIO_BASE_URL = os.environ.get("COMPOSIO_BASE_URL", "https://backend.composio.dev")
BRAVE_API_KEY = os.environ.get("BRAVE_API_KEY", "")
PERPLEXITY_API_KEY = os.environ.get("PERPLEXITY_API_KEY", "")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("workz")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Workz Ventures AI Platform", version="1.0.0")
api_router = APIRouter(prefix="/api")
bearer_scheme = HTTPBearer(auto_error=False)


# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------
class UserPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: EmailStr
    name: str
    role: Literal["admin", "buyer", "seller"] = "buyer"
    organization: Optional[str] = None
    interests: List[str] = Field(default_factory=list)
    newsletter_opt_in: bool = False
    created_at: datetime


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    organization: Optional[str] = None
    role: Literal["admin", "buyer", "seller"] = "buyer"


class ListingCreate(BaseModel):
    company_name: str
    sector: str
    geography: str
    asking_price_usd_m: float
    revenue_usd_m: Optional[float] = None
    ebitda_usd_m: Optional[float] = None
    employees: Optional[int] = None
    headline: str
    summary: str
    highlights: List[str] = Field(default_factory=list)
    status: Literal["draft", "live", "under_loi", "closed"] = "draft"


class InquiryCreate(BaseModel):
    message: str


class FileUpload(BaseModel):
    filename: str
    folder: Literal["financials", "legal", "hr", "it", "operations", "commercial", "other"] = "other"
    content: str  # extracted/pasted text content
    note: Optional[str] = None


class DRLApply(BaseModel):
    template_id: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    token: str
    user: UserPublic


class CompanyResearchRequest(BaseModel):
    company_name: str
    sector: Optional[str] = None
    region: Optional[str] = None
    notes: Optional[str] = None


class CollateralRequest(BaseModel):
    asset_type: Literal["one_pager", "email_sequence", "linkedin_post", "deal_memo"]
    deal_name: str
    target_audience: str
    key_points: str
    tone: Optional[str] = "professional-institutional"


class OutreachCampaignRequest(BaseModel):
    name: str
    target_persona: str
    channel: Literal["linkedin", "email"] = "linkedin"
    audience_size: int = 50
    message_brief: str


class LeadCreate(BaseModel):
    name: str
    company: str
    title: str
    email: Optional[EmailStr] = None
    source: Optional[str] = "manual"


class LeadStageUpdate(BaseModel):
    stage: Literal["new", "qualified", "engaged", "negotiation", "closed"]


class NewsletterPreferences(BaseModel):
    opt_in: bool
    interests: List[str] = Field(default_factory=list)
    cadence: Literal["weekly", "biweekly", "monthly"] = "weekly"


class NewsletterDraftRequest(BaseModel):
    topic: Optional[str] = None


# -----------------------------------------------------------------------------
# Utility helpers
# -----------------------------------------------------------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "iat": int(now_utc().timestamp()),
        "exp": int((now_utc() + timedelta(hours=JWT_EXPIRY_HOURS)).timestamp()),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Dict[str, Any]:
    try:
        return pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def serialize_user(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "email": doc["email"],
        "name": doc["name"],
        "role": doc.get("role", "buyer"),
        "organization": doc.get("organization"),
        "interests": doc.get("interests", []),
        "newsletter_opt_in": doc.get("newsletter_opt_in", False),
        "created_at": doc["created_at"]
        if isinstance(doc["created_at"], datetime)
        else datetime.fromisoformat(doc["created_at"]),
    }


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    payload = decode_token(credentials.credentials)
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_role(user: dict, allowed: List[str]):
    if user.get("role") not in allowed:
        raise HTTPException(status_code=403, detail="Insufficient role")


async def log_audit(actor_id: str, action: str, target: str = "", meta: Optional[dict] = None):
    doc = {
        "id": str(uuid.uuid4()),
        "actor_id": actor_id,
        "action": action,
        "target": target,
        "meta": meta or {},
        "timestamp": now_utc().isoformat(),
    }
    await db.audit_logs.insert_one(doc)


async def log_agent_activity(
    agent: str,
    task: str,
    status: str,
    user_id: str = "system",
    duration_ms: int = 0,
    friction: Optional[str] = None,
    meta: Optional[dict] = None,
):
    doc = {
        "id": str(uuid.uuid4()),
        "agent": agent,
        "task": task,
        "status": status,
        "user_id": user_id,
        "duration_ms": duration_ms,
        "friction": friction,
        "meta": meta or {},
        "timestamp": now_utc().isoformat(),
    }
    await db.agent_activity.insert_one(doc)


# -----------------------------------------------------------------------------
# Claude helper
# -----------------------------------------------------------------------------
async def call_claude(system_message: str, user_text: str, session_id: Optional[str] = None) -> str:
    session_id = session_id or f"workz-{uuid.uuid4()}"
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system_message,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    response = await chat.send_message(UserMessage(text=user_text))
    return response if isinstance(response, str) else str(response)


def safe_json_loads(raw: str) -> dict:
    """Strip ```json fences and parse, falling back to empty dict."""
    txt = raw.strip()
    if txt.startswith("```"):
        txt = txt.split("```")[1] if "```" in txt[3:] else txt[3:]
        if txt.lower().startswith("json"):
            txt = txt[4:]
        txt = txt.strip()
        if txt.endswith("```"):
            txt = txt[:-3].strip()
    try:
        return json.loads(txt)
    except Exception:
        # Try to find first { ... } block
        start = txt.find("{")
        end = txt.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(txt[start : end + 1])
            except Exception:
                pass
        return {"raw": raw}


# -----------------------------------------------------------------------------
# MCP Action Registry
# -----------------------------------------------------------------------------
MCP_ACTIONS = [
    {
        "id": "research.company.summarize",
        "type": "imperative",
        "description": "Generate AI research summary for any company (profile, leadership, market signals).",
        "endpoint": "/api/research/company",
        "method": "POST",
        "auth": "jwt",
        "dom_selector": "[data-mcp-action='research.company.summarize']",
        "params": {"company_name": "string", "sector": "string?", "region": "string?"},
    },
    {
        "id": "collateral.generate",
        "type": "imperative",
        "description": "Generate marketing collateral (one-pager, email sequence, LinkedIn post, deal memo).",
        "endpoint": "/api/collateral/generate",
        "method": "POST",
        "auth": "jwt",
        "dom_selector": "[data-mcp-action='collateral.generate']",
        "params": {"asset_type": "enum", "deal_name": "string", "target_audience": "string", "key_points": "string"},
    },
    {
        "id": "outreach.campaign.create",
        "type": "imperative",
        "description": "Launch a personalized outreach campaign on LinkedIn or email.",
        "endpoint": "/api/outreach/campaigns",
        "method": "POST",
        "auth": "jwt",
        "dom_selector": "[data-mcp-action='outreach.campaign.create']",
        "params": {"name": "string", "target_persona": "string", "channel": "enum", "message_brief": "string"},
    },
    {
        "id": "leads.list",
        "type": "declarative",
        "description": "List all leads in the nurturing pipeline grouped by stage.",
        "endpoint": "/api/leads",
        "method": "GET",
        "auth": "jwt",
        "dom_selector": "[data-mcp-action='leads.list']",
        "params": {},
    },
    {
        "id": "leads.advance",
        "type": "imperative",
        "description": "Advance a lead to the next nurturing stage.",
        "endpoint": "/api/leads/{lead_id}/stage",
        "method": "PATCH",
        "auth": "jwt",
        "dom_selector": "[data-mcp-action='leads.advance']",
        "params": {"lead_id": "string", "stage": "enum"},
    },
    {
        "id": "newsletter.draft",
        "type": "imperative",
        "description": "AI-draft a personalized newsletter for the current buyer.",
        "endpoint": "/api/newsletter/draft",
        "method": "POST",
        "auth": "jwt",
        "dom_selector": "[data-mcp-action='newsletter.draft']",
        "params": {"topic": "string?"},
    },
    {
        "id": "newsletter.dispatch",
        "type": "imperative",
        "description": "Approve and dispatch a newsletter to all opted-in buyers.",
        "endpoint": "/api/newsletter/{id}/dispatch",
        "method": "POST",
        "auth": "jwt",
        "dom_selector": "[data-mcp-action='newsletter.dispatch']",
        "params": {"id": "string"},
    },
    {
        "id": "composio.linkedin.connect",
        "type": "imperative",
        "description": "Initiate LinkedIn OAuth connection through Composio gateway.",
        "endpoint": "/api/composio/connect/linkedin",
        "method": "POST",
        "auth": "jwt",
        "dom_selector": "[data-mcp-action='composio.linkedin.connect']",
        "params": {},
    },
    {
        "id": "dashboard.kpis",
        "type": "declarative",
        "description": "Read top-level KPIs (AUM, active deals, pipeline value, engagement).",
        "endpoint": "/api/dashboard/stats",
        "method": "GET",
        "auth": "jwt",
        "dom_selector": "[data-mcp-action='dashboard.kpis']",
        "params": {},
    },
]


# -----------------------------------------------------------------------------
# AUTH ROUTES
# -----------------------------------------------------------------------------
@api_router.post("/auth/register", response_model=TokenResponse)
async def register(body: RegisterRequest):
    existing = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": body.email.lower(),
        "name": body.name,
        "role": body.role,
        "organization": body.organization,
        "password_hash": hash_password(body.password),
        "interests": [],
        "newsletter_opt_in": False,
        "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(doc)
    token = create_token(user_id, body.role)
    await log_audit(user_id, "auth.register", body.email)
    return TokenResponse(token=token, user=UserPublic(**serialize_user(doc)))


@api_router.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(user["id"], user["role"])
    await log_audit(user["id"], "auth.login", body.email)
    return TokenResponse(token=token, user=UserPublic(**serialize_user(user)))


@api_router.get("/auth/me", response_model=UserPublic)
async def me(user=Depends(get_current_user)):
    return UserPublic(**serialize_user(user))


# -----------------------------------------------------------------------------
# DASHBOARD
# -----------------------------------------------------------------------------
@api_router.get("/dashboard/stats")
async def dashboard_stats(user=Depends(get_current_user)):
    deals = await db.deals.count_documents({})
    leads = await db.leads.count_documents({})
    campaigns = await db.outreach.count_documents({})
    newsletters = await db.newsletters.count_documents({})
    research = await db.research.count_documents({})
    activities = await db.agent_activity.count_documents({})
    success = await db.agent_activity.count_documents({"status": "completed"})
    success_rate = round((success / activities * 100) if activities else 0, 1)

    role = user.get("role", "buyer")
    uid = user["id"]

    if role == "seller":
        my_listings = await db.listings.count_documents({"seller_id": uid})
        live_listings = await db.listings.count_documents({"seller_id": uid, "status": "live"})
        inbound = await db.inquiries.count_documents({"seller_id": uid})
        pipeline_value = 0.0
        async for d in db.listings.find({"seller_id": uid}, {"_id": 0, "asking_price_usd_m": 1}):
            pipeline_value += float(d.get("asking_price_usd_m") or 0)
        my_campaigns = await db.outreach.count_documents({"user_id": uid})
        my_leads = await db.leads.count_documents({"user_id": uid})
        my_newsletters = await db.newsletters.count_documents({"user_id": uid})
        return {
            "role": role,
            "my_listings": my_listings,
            "live_listings": live_listings,
            "inbound_inquiries": inbound,
            "pipeline_value_usd_m": round(pipeline_value, 1),
            "my_campaigns": my_campaigns,
            "my_leads": my_leads,
            "my_newsletters": my_newsletters,
            "agent_success_rate": success_rate,
            "agent_runs": activities,
        }

    if role == "buyer":
        marketplace_count = await db.listings.count_documents({"status": "live"})
        my_research = await db.research.count_documents({"user_id": uid})
        my_inquiries = await db.inquiries.count_documents({"buyer_id": uid})
        my_newsletters_received = await db.newsletters.count_documents({"status": "dispatched"})
        watchlist_count = await db.watchlist.count_documents({"user_id": uid})
        return {
            "role": role,
            "marketplace_listings": marketplace_count,
            "my_research_count": my_research,
            "my_inquiries": my_inquiries,
            "watchlist_count": watchlist_count,
            "newsletters_received": my_newsletters_received,
            "aum_usd_b": 14.7,
            "agent_success_rate": success_rate,
            "exit_velocity_days": 142,
        }

    # admin / fallback — global view
    return {
        "role": role,
        "aum_usd_b": 14.7,
        "active_deals": deals,
        "pipeline_leads": leads,
        "campaigns": campaigns,
        "newsletters_sent": newsletters,
        "research_count": research,
        "agent_success_rate": success_rate,
        "agent_runs": activities,
        "exit_velocity_days": 142,
        "marketplace_listings": await db.listings.count_documents({"status": "live"}),
        "total_inquiries": await db.inquiries.count_documents({}),
    }


@api_router.get("/deals")
async def list_deals(user=Depends(get_current_user)):
    deals = await db.deals.find({}, {"_id": 0}).to_list(200)
    return deals


# -----------------------------------------------------------------------------
# LISTINGS · MARKETPLACE · INQUIRIES · WATCHLIST
# -----------------------------------------------------------------------------
@api_router.get("/listings")
async def my_listings(user=Depends(get_current_user)):
    """Seller view — list my listings."""
    items = await db.listings.find({"seller_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return items


@api_router.post("/listings")
async def create_listing(body: ListingCreate, user=Depends(get_current_user)):
    if user.get("role") not in ("seller", "admin"):
        raise HTTPException(status_code=403, detail="Sellers only")
    doc = {
        "id": str(uuid.uuid4()),
        "seller_id": user["id"],
        "seller_name": user.get("name"),
        "seller_org": user.get("organization"),
        **body.model_dump(),
        "inquiry_count": 0,
        "view_count": 0,
        "created_at": now_utc().isoformat(),
    }
    await db.listings.insert_one(doc)
    await log_audit(user["id"], "listing.create", body.company_name)
    doc.pop("_id", None)
    return doc


@api_router.patch("/listings/{lid}")
async def update_listing(lid: str, body: ListingCreate, user=Depends(get_current_user)):
    res = await db.listings.update_one(
        {"id": lid, "seller_id": user["id"]},
        {"$set": body.model_dump()},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Listing not found")
    await log_audit(user["id"], "listing.update", lid)
    return {"ok": True}


@api_router.delete("/listings/{lid}")
async def delete_listing(lid: str, user=Depends(get_current_user)):
    res = await db.listings.delete_one({"id": lid, "seller_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Listing not found")
    await log_audit(user["id"], "listing.delete", lid)
    return {"ok": True}


@api_router.get("/marketplace")
async def marketplace(user=Depends(get_current_user)):
    """Buyer view — public live listings from every seller."""
    items = await db.listings.find({"status": "live"}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items


@api_router.get("/marketplace/{lid}")
async def marketplace_detail(lid: str, user=Depends(get_current_user)):
    item = await db.listings.find_one({"id": lid}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Listing not found")
    await db.listings.update_one({"id": lid}, {"$inc": {"view_count": 1}})
    return item


@api_router.post("/marketplace/{lid}/inquire")
async def inquire(lid: str, body: InquiryCreate, user=Depends(get_current_user)):
    listing = await db.listings.find_one({"id": lid}, {"_id": 0})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    doc = {
        "id": str(uuid.uuid4()),
        "listing_id": lid,
        "listing_name": listing["company_name"],
        "seller_id": listing["seller_id"],
        "buyer_id": user["id"],
        "buyer_name": user.get("name"),
        "buyer_org": user.get("organization"),
        "buyer_email": user.get("email"),
        "message": body.message,
        "status": "new",
        "created_at": now_utc().isoformat(),
    }
    await db.inquiries.insert_one(doc)
    await db.listings.update_one({"id": lid}, {"$inc": {"inquiry_count": 1}})
    await log_audit(user["id"], "inquiry.create", lid)
    await log_agent_activity("matchmaking-agent", f"inquiry:{listing['company_name']}", "completed", user_id=user["id"])
    doc.pop("_id", None)
    return doc


@api_router.get("/inquiries")
async def list_inquiries(user=Depends(get_current_user)):
    """Sellers see inbound; buyers see outbound; admin sees all."""
    role = user.get("role", "buyer")
    if role == "seller":
        q = {"seller_id": user["id"]}
    elif role == "buyer":
        q = {"buyer_id": user["id"]}
    else:
        q = {}
    items = await db.inquiries.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items


@api_router.patch("/inquiries/{iid}/status")
async def update_inquiry(iid: str, body: dict, user=Depends(get_current_user)):
    new_status = body.get("status")
    if new_status not in ("new", "reviewing", "engaged", "passed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db.inquiries.update_one(
        {"id": iid, "seller_id": user["id"]},
        {"$set": {"status": new_status}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    await log_audit(user["id"], "inquiry.status", iid, {"status": new_status})
    return {"ok": True}


@api_router.get("/watchlist")
async def get_watchlist(user=Depends(get_current_user)):
    items = await db.watchlist.find({"user_id": user["id"]}, {"_id": 0}).to_list(100)
    return items


@api_router.post("/watchlist/{lid}")
async def add_watch(lid: str, user=Depends(get_current_user)):
    if await db.watchlist.find_one({"user_id": user["id"], "listing_id": lid}):
        return {"ok": True, "already": True}
    listing = await db.listings.find_one({"id": lid}, {"_id": 0})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "listing_id": lid,
        "company_name": listing["company_name"],
        "sector": listing["sector"],
        "asking_price_usd_m": listing["asking_price_usd_m"],
        "created_at": now_utc().isoformat(),
    }
    await db.watchlist.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.delete("/watchlist/{lid}")
async def remove_watch(lid: str, user=Depends(get_current_user)):
    await db.watchlist.delete_one({"user_id": user["id"], "listing_id": lid})
    return {"ok": True}


# -----------------------------------------------------------------------------
# RESEARCH HUB
# -----------------------------------------------------------------------------
RESEARCH_SYS = """You are a senior M&A analyst at Workz Ventures. Write a concise institutional research brief.
Return STRICT JSON only (no markdown). Keep arrays to MAX 3 items. Keep each text field under 240 chars.
You are given an indexed list of LIVE web SOURCES. Cite them inline as [1], [2], ... inside text fields where you make a claim derived from the source. Do not invent citations beyond the list provided.
Schema:
{
  "company_name": str,
  "one_liner": str,
  "sector": str,
  "headquarters": str,
  "founded": str,
  "employees_range": str,
  "estimated_revenue": str,
  "business_model": str,
  "leadership": [{"name": str, "title": str, "background": str}],
  "market_signals": [str],
  "growth_drivers": [str],
  "risks": [str],
  "competitive_landscape": [str],
  "investor_take": str,
  "suggested_buyer_profile": str,
  "next_actions": [str]
}
Be specific, analytical, terse. Prefer claims grounded in the provided SOURCES; otherwise mark with a [-] placeholder."""


# -----------------------------------------------------------------------------
# Real-time web research helpers (Brave + Perplexity Sonar)
# -----------------------------------------------------------------------------
async def search_brave(query: str, count: int = 6) -> List[dict]:
    if not BRAVE_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=12.0) as c:
            r = await c.get(
                "https://api.search.brave.com/res/v1/web/search",
                headers={"X-Subscription-Token": BRAVE_API_KEY, "Accept": "application/json"},
                params={"q": query, "count": count, "country": "US", "search_lang": "en"},
            )
            if r.status_code >= 400:
                logger.warning(f"Brave {r.status_code}: {r.text[:200]}")
                return []
            data = r.json()
            results = (data.get("web") or {}).get("results") or []
            return [
                {
                    "title": x.get("title") or "",
                    "url": x.get("url") or "",
                    "snippet": (x.get("description") or "")[:300],
                    "age": x.get("age") or x.get("page_age") or "",
                    "provider": "brave",
                }
                for x in results[:count]
                if x.get("url")
            ]
    except Exception as e:
        logger.warning(f"Brave search failed: {e}")
        return []


async def query_perplexity(prompt: str, model: str = "sonar-pro") -> dict:
    """Returns {'text': str, 'citations': [url, url...]}."""
    if not PERPLEXITY_API_KEY:
        return {"text": "", "citations": []}
    try:
        async with httpx.AsyncClient(timeout=25.0) as c:
            r = await c.post(
                "https://api.perplexity.ai/chat/completions",
                headers={
                    "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a research analyst. Provide a concise factual overview for institutional investors. Cite all material claims.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.1,
                    "max_tokens": 900,
                },
            )
            if r.status_code >= 400:
                logger.warning(f"Perplexity {r.status_code}: {r.text[:300]}")
                return {"text": "", "citations": []}
            data = r.json()
            text = ""
            choices = data.get("choices") or []
            if choices:
                text = (choices[0].get("message") or {}).get("content") or ""
            citations = data.get("citations") or data.get("search_results") or []
            urls = []
            for c2 in citations:
                if isinstance(c2, str):
                    urls.append(c2)
                elif isinstance(c2, dict) and c2.get("url"):
                    urls.append(c2["url"])
            return {"text": text, "citations": urls}
    except Exception as e:
        logger.warning(f"Perplexity failed: {e}")
        return {"text": "", "citations": []}


def build_sources(perplexity_urls: List[str], brave_hits: List[dict]) -> List[dict]:
    """Merge Perplexity citations + Brave results into a numbered, deduped source list."""
    seen = set()
    sources = []
    idx = 1
    for url in perplexity_urls:
        if not url or url in seen:
            continue
        seen.add(url)
        sources.append({"index": idx, "url": url, "title": "", "provider": "perplexity"})
        idx += 1
    for hit in brave_hits:
        url = hit.get("url")
        if not url or url in seen:
            continue
        seen.add(url)
        sources.append({
            "index": idx,
            "url": url,
            "title": hit.get("title", ""),
            "snippet": hit.get("snippet", ""),
            "age": hit.get("age", ""),
            "provider": "brave",
        })
        idx += 1
    return sources


@api_router.post("/research/company")
async def research_company(body: CompanyResearchRequest, user=Depends(get_current_user)):
    started = now_utc()
    company = body.company_name

    # Phase 1: gather live web evidence in parallel (Perplexity Sonar + Brave)
    sonar_prompt = (
        f"Provide an institutional-investor overview of {company}"
        + (f" (sector hint: {body.sector})" if body.sector else "")
        + (f" (region: {body.region})" if body.region else "")
        + ". Cover business model, recent news, leadership, competitive position, and any 2026 events."
    )
    brave_query = f"{company} {body.sector or ''} company news 2026".strip()

    perplexity_task = query_perplexity(sonar_prompt)
    brave_task = search_brave(brave_query, count=6)
    perplexity_res, brave_res = await asyncio.gather(perplexity_task, brave_task)

    sources = build_sources(perplexity_res.get("citations", []), brave_res)

    # Phase 2: feed grounded context to Claude
    sources_block = "\n".join(
        f"[{s['index']}] {s.get('title') or s['url']} — {s['url']}"
        + (f" :: {s.get('snippet')}" if s.get("snippet") else "")
        for s in sources
    ) or "(no live sources available — proceed with model knowledge)"

    perplexity_summary = (perplexity_res.get("text") or "").strip()
    grounded_user = (
        f"Company: {company}\n"
        f"Sector hint: {body.sector or 'unspecified'}\n"
        f"Region hint: {body.region or 'global'}\n"
        f"Buyer notes: {body.notes or 'none'}\n\n"
        f"LIVE WEB-RESEARCH SUMMARY (from real-time search):\n{perplexity_summary or '(none)'}\n\n"
        f"SOURCES (cite as [n] inline):\n{sources_block}\n\n"
        "Now produce the JSON brief, embedding [n] citations where you reference a source."
    )

    try:
        raw = await call_claude(RESEARCH_SYS, grounded_user, session_id=f"research-{user['id']}")
        data = safe_json_loads(raw)
    except Exception as e:
        logger.exception("Claude research failed")
        await log_agent_activity("research-agent", f"research:{company}", "failed",
                                 user_id=user["id"], friction=str(e))
        raise HTTPException(status_code=502, detail=f"AI research failed: {e}")

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "company_name": company,
        "sector": body.sector,
        "region": body.region,
        "data": data,
        "sources": sources,
        "live_research_used": bool(perplexity_summary or brave_res),
        "created_at": now_utc().isoformat(),
    }
    await db.research.insert_one(doc)
    duration = int((now_utc() - started).total_seconds() * 1000)
    await log_agent_activity(
        "research-agent",
        f"research:{company} · grounded({len(sources)} sources)",
        "completed",
        user_id=user["id"],
        duration_ms=duration,
        meta={"sources_count": len(sources), "providers": list({s["provider"] for s in sources})},
    )
    await log_audit(user["id"], "research.create", company, {"sources": len(sources)})
    doc.pop("_id", None)
    return doc


@api_router.get("/research/history")
async def research_history(user=Depends(get_current_user)):
    items = await db.research.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return items


# -----------------------------------------------------------------------------
# COLLATERAL
# -----------------------------------------------------------------------------
COLLATERAL_SYS = """You are a senior marketing copywriter for a top-tier private equity firm, Workz Ventures.
You write polished, institutional-grade marketing collateral.
ALWAYS return STRICT JSON (no markdown fences):
{
  "title": str,
  "asset_type": str,
  "headline": str,
  "subheadline": str,
  "sections": [{"heading": str, "body": str}],
  "cta": str,
  "compliance_note": str
}
"""


@api_router.post("/collateral/generate")
async def generate_collateral(body: CollateralRequest, user=Depends(get_current_user)):
    started = now_utc()
    user_prompt = (
        f"Asset type: {body.asset_type}\n"
        f"Deal: {body.deal_name}\n"
        f"Target audience: {body.target_audience}\n"
        f"Key points: {body.key_points}\n"
        f"Tone: {body.tone}\n"
        "Produce the JSON now."
    )
    raw = await call_claude(COLLATERAL_SYS, user_prompt, session_id=f"collateral-{user['id']}")
    data = safe_json_loads(raw)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "asset_type": body.asset_type,
        "deal_name": body.deal_name,
        "target_audience": body.target_audience,
        "data": data,
        "created_at": now_utc().isoformat(),
    }
    await db.collateral.insert_one(doc)
    duration = int((now_utc() - started).total_seconds() * 1000)
    await log_agent_activity("marketing-agent", f"collateral:{body.asset_type}", "completed",
                             user_id=user["id"], duration_ms=duration)
    await log_audit(user["id"], "collateral.generate", body.asset_type)
    doc.pop("_id", None)
    return doc


@api_router.get("/collateral")
async def list_collateral(user=Depends(get_current_user)):
    items = await db.collateral.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return items


# -----------------------------------------------------------------------------
# OUTREACH
# -----------------------------------------------------------------------------
OUTREACH_SYS = """You are a senior sales enablement specialist. Draft a personalized outreach message.
Return STRICT JSON:
{
  "subject": str,
  "opening": str,
  "value_props": [str],
  "social_proof": str,
  "cta": str,
  "linkedin_message": str,
  "email_body": str
}
"""


@api_router.post("/outreach/campaigns")
async def create_campaign(body: OutreachCampaignRequest, user=Depends(get_current_user)):
    started = now_utc()
    raw = await call_claude(
        OUTREACH_SYS,
        f"Persona: {body.target_persona}\nChannel: {body.channel}\nBrief: {body.message_brief}\nReturn JSON.",
        session_id=f"outreach-{user['id']}",
    )
    draft = safe_json_loads(raw)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "name": body.name,
        "target_persona": body.target_persona,
        "channel": body.channel,
        "audience_size": body.audience_size,
        "message_brief": body.message_brief,
        "draft": draft,
        "status": "draft",
        "sent_count": 0,
        "reply_count": 0,
        "created_at": now_utc().isoformat(),
    }
    await db.outreach.insert_one(doc)
    duration = int((now_utc() - started).total_seconds() * 1000)
    await log_agent_activity("outreach-agent", f"campaign:{body.name}", "completed",
                             user_id=user["id"], duration_ms=duration)
    await log_audit(user["id"], "outreach.create", body.name)
    doc.pop("_id", None)
    return doc


@api_router.get("/outreach/campaigns")
async def list_campaigns(user=Depends(get_current_user)):
    items = await db.outreach.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return items


@api_router.post("/outreach/campaigns/{cid}/launch")
async def launch_campaign(cid: str, user=Depends(get_current_user)):
    """MOCK: marks campaign as launched and simulates sent count."""
    camp = await db.outreach.find_one({"id": cid, "user_id": user["id"]}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Campaign not found")
    new_sent = camp.get("audience_size", 50)
    await db.outreach.update_one(
        {"id": cid},
        {"$set": {"status": "launched", "sent_count": new_sent, "launched_at": now_utc().isoformat()}},
    )
    await log_audit(user["id"], "outreach.launch", cid)
    await log_agent_activity("outreach-agent", f"launch:{cid}", "completed", user_id=user["id"])
    return {"ok": True, "sent_count": new_sent, "note": "MOCKED dispatch (Composio LinkedIn / email)"}


# -----------------------------------------------------------------------------
# LEADS
# -----------------------------------------------------------------------------
@api_router.get("/leads")
async def list_leads(user=Depends(get_current_user)):
    items = await db.leads.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@api_router.post("/leads")
async def create_lead(body: LeadCreate, user=Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "name": body.name,
        "company": body.company,
        "title": body.title,
        "email": body.email,
        "source": body.source,
        "stage": "new",
        "score": 50,
        "created_at": now_utc().isoformat(),
    }
    await db.leads.insert_one(doc)
    await log_audit(user["id"], "lead.create", body.name)
    doc.pop("_id", None)
    return doc


@api_router.patch("/leads/{lead_id}/stage")
async def update_lead_stage(lead_id: str, body: LeadStageUpdate, user=Depends(get_current_user)):
    res = await db.leads.update_one(
        {"id": lead_id, "user_id": user["id"]},
        {"$set": {"stage": body.stage}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    await log_audit(user["id"], "lead.stage", lead_id, {"stage": body.stage})
    await log_agent_activity("nurturing-agent", f"advance:{lead_id}->{body.stage}", "completed", user_id=user["id"])
    return {"ok": True}


# -----------------------------------------------------------------------------
# NEWSLETTER
# -----------------------------------------------------------------------------
NEWSLETTER_SYS = """You are an editor for Workz Ventures' institutional buyer newsletter.
Compile a concise, sharp newsletter tailored to a buyer's interests.
Return STRICT JSON:
{
  "title": str,
  "issue_tagline": str,
  "deal_spotlights": [{"headline": str, "summary": str}],
  "market_analysis": str,
  "portfolio_updates": [str],
  "editor_note": str
}
"""


@api_router.get("/newsletter/preferences")
async def get_prefs(user=Depends(get_current_user)):
    return {
        "opt_in": user.get("newsletter_opt_in", False),
        "interests": user.get("interests", []),
        "cadence": user.get("newsletter_cadence", "weekly"),
    }


@api_router.post("/newsletter/preferences")
async def set_prefs(body: NewsletterPreferences, user=Depends(get_current_user)):
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "newsletter_opt_in": body.opt_in,
            "interests": body.interests,
            "newsletter_cadence": body.cadence,
        }},
    )
    await log_audit(user["id"], "newsletter.preferences", "", body.model_dump())
    return {"ok": True}


@api_router.post("/newsletter/draft")
async def draft_newsletter(body: NewsletterDraftRequest, user=Depends(get_current_user)):
    """Used by sellers (or admins) to draft a broadcast newsletter to opted-in buyers."""
    if user.get("role") not in ("seller", "admin"):
        raise HTTPException(status_code=403, detail="Broadcasts are seller/admin only")
    started = now_utc()
    interests = ", ".join(user.get("interests", [])) or "institutional buyers"
    topic = body.topic or "this week's deal flow and market signals"
    raw = await call_claude(
        NEWSLETTER_SYS,
        f"Audience: {interests}\nTopic focus: {topic}\nProduce JSON.",
        session_id=f"newsletter-{user['id']}",
    )
    data = safe_json_loads(raw)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "kind": "broadcast",
        "sender_name": user.get("name"),
        "sender_org": user.get("organization"),
        "data": data,
        "status": "draft",
        "approved_by": None,
        "dispatched_at": None,
        "recipients": 0,
        "created_at": now_utc().isoformat(),
    }
    await db.newsletters.insert_one(doc)
    duration = int((now_utc() - started).total_seconds() * 1000)
    await log_agent_activity("newsletter-agent", "draft:broadcast", "completed", user_id=user["id"], duration_ms=duration)
    await log_audit(user["id"], "newsletter.draft", doc["id"])
    doc.pop("_id", None)
    return doc


@api_router.post("/newsletter/personal")
async def personal_newsletter(body: NewsletterDraftRequest, user=Depends(get_current_user)):
    """Buyer self-service: generate AND deliver a personalized digest in one call (recipient=self)."""
    if user.get("role") not in ("buyer", "admin"):
        raise HTTPException(status_code=403, detail="Personal digests are buyer/admin only")
    started = now_utc()
    interests = ", ".join(user.get("interests", [])) or "general institutional buying themes"
    topic = body.topic or "today's deal flow, market signals, and portfolio updates"
    raw = await call_claude(
        NEWSLETTER_SYS,
        (
            f"This is a PERSONAL digest for ONE institutional buyer named {user.get('name')} "
            f"at {user.get('organization') or 'an institutional fund'}. "
            f"Their stated interests: {interests}. "
            f"Topic focus: {topic}. "
            "Tailor every section to THIS reader. Speak as Workz Ventures. Produce JSON."
        ),
        session_id=f"newsletter-personal-{user['id']}",
    )
    data = safe_json_loads(raw)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "kind": "personal",
        "sender_name": "Workz Ventures",
        "sender_org": "Workz Ventures",
        "recipient_email": user["email"],
        "recipient_name": user.get("name"),
        "data": data,
        "status": "dispatched",
        "approved_by": user["id"],
        "approved_at": now_utc().isoformat(),
        "dispatched_at": now_utc().isoformat(),
        "recipients": 1,
        "created_at": now_utc().isoformat(),
    }
    await db.newsletters.insert_one(doc)
    duration = int((now_utc() - started).total_seconds() * 1000)
    await log_agent_activity("newsletter-agent", "personal:delivered", "completed", user_id=user["id"], duration_ms=duration)
    await log_audit(user["id"], "newsletter.personal", doc["id"])
    doc.pop("_id", None)
    return doc


@api_router.get("/newsletter")
async def list_newsletters(user=Depends(get_current_user)):
    items = await db.newsletters.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    for it in items:
        it.setdefault("kind", "broadcast")
    return items


@api_router.post("/newsletter/{nid}/approve")
async def approve_newsletter(nid: str, user=Depends(get_current_user)):
    res = await db.newsletters.update_one(
        {"id": nid, "user_id": user["id"]},
        {"$set": {"status": "approved", "approved_by": user["id"], "approved_at": now_utc().isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Newsletter not found")
    await log_audit(user["id"], "newsletter.approve", nid)
    return {"ok": True}


@api_router.post("/newsletter/{nid}/dispatch")
async def dispatch_newsletter(nid: str, user=Depends(get_current_user)):
    """MOCKED email dispatch (Resend integration mocked per user choice).
    Broadcast → opted-in buyers count. Personal → already delivered (recipients=1)."""
    nl = await db.newsletters.find_one({"id": nid, "user_id": user["id"]}, {"_id": 0})
    if not nl:
        raise HTTPException(status_code=404, detail="Newsletter not found")
    if nl.get("kind") == "personal":
        return {"ok": True, "recipients": 1, "note": "personal digest already delivered"}
    opted_in = await db.users.count_documents({"newsletter_opt_in": True, "role": "buyer"})
    await db.newsletters.update_one(
        {"id": nid},
        {"$set": {
            "status": "dispatched",
            "dispatched_at": now_utc().isoformat(),
            "recipients": opted_in,
        }},
    )
    await log_audit(user["id"], "newsletter.dispatch", nid, {"recipients": opted_in})
    await log_agent_activity("newsletter-agent", f"dispatch:{nid}", "completed", user_id=user["id"])
    return {"ok": True, "recipients": opted_in, "note": "MOCKED email dispatch (Resend not wired)"}


# -----------------------------------------------------------------------------
# MCP ACTIONS
# -----------------------------------------------------------------------------
@api_router.get("/mcp/actions")
async def mcp_actions(user=Depends(get_current_user)):
    return {"actions": MCP_ACTIONS, "count": len(MCP_ACTIONS)}


@api_router.get("/mcp/manifest")
async def mcp_manifest():
    """Public manifest of WebMCP actions for AI-agent discovery."""
    return {
        "name": "Workz Ventures MCP",
        "version": "1.0.0",
        "gateway": "composio",
        "actions": [{"id": a["id"], "type": a["type"], "description": a["description"]} for a in MCP_ACTIONS],
    }


# -----------------------------------------------------------------------------
# AGENT ACTIVITY
# -----------------------------------------------------------------------------
@api_router.get("/agents/activity")
async def agent_activity(user=Depends(get_current_user)):
    items = await db.agent_activity.find({}, {"_id": 0}).sort("timestamp", -1).to_list(100)
    return items


@api_router.get("/agents/stats")
async def agent_stats(user=Depends(get_current_user)):
    total = await db.agent_activity.count_documents({})
    completed = await db.agent_activity.count_documents({"status": "completed"})
    failed = await db.agent_activity.count_documents({"status": "failed"})
    by_agent_cursor = db.agent_activity.aggregate([
        {"$group": {"_id": "$agent", "count": {"$sum": 1}}},
    ])
    by_agent = [{"agent": d["_id"], "count": d["count"]} async for d in by_agent_cursor]
    return {
        "total": total,
        "completed": completed,
        "failed": failed,
        "success_rate": round((completed / total * 100) if total else 0, 1),
        "by_agent": by_agent,
    }


# -----------------------------------------------------------------------------
# COMPOSIO
# -----------------------------------------------------------------------------
@api_router.get("/composio/status")
async def composio_status(user=Depends(get_current_user)):
    return {
        "configured": bool(COMPOSIO_API_KEY),
        "gateway": COMPOSIO_BASE_URL,
        "supported_apps": ["LINKEDIN", "ZOHO_CRM", "GMAIL", "SLACK", "HUBSPOT", "SALESFORCE"],
    }


@api_router.get("/composio/connections")
async def composio_connections(user=Depends(get_current_user)):
    """List user's connected Composio accounts. Falls back to stored connections on API error."""
    stored = await db.composio_connections.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return {"connections": stored, "gateway": COMPOSIO_BASE_URL}


@api_router.post("/composio/connect/linkedin")
async def composio_connect_linkedin(user=Depends(get_current_user)):
    """Initiate LinkedIn OAuth via Composio. Stores a pending connection record."""
    if not COMPOSIO_API_KEY:
        raise HTTPException(status_code=400, detail="Composio API key missing")

    entity_id = f"workz-{user['id']}"
    redirect_url = f"https://app.composio.dev/connect/linkedin?entity={entity_id}"
    status_label = "pending"

    # Attempt real Composio v3 initiate connection
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.post(
                f"{COMPOSIO_BASE_URL}/api/v3/connectedAccounts",
                headers={"x-api-key": COMPOSIO_API_KEY, "Content-Type": "application/json"},
                json={"appName": "linkedin", "entityId": entity_id},
            )
            if r.status_code < 400:
                payload = r.json()
                redirect_url = payload.get("redirectUrl") or payload.get("redirect_url") or redirect_url
    except Exception as e:
        logger.warning(f"Composio LinkedIn init failed, using placeholder: {e}")

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "app": "linkedin",
        "entity_id": entity_id,
        "status": status_label,
        "redirect_url": redirect_url,
        "created_at": now_utc().isoformat(),
    }
    await db.composio_connections.insert_one(doc)
    await log_audit(user["id"], "composio.connect.linkedin", entity_id)
    doc.pop("_id", None)
    return doc


@api_router.delete("/composio/connections/{cid}")
async def remove_connection(cid: str, user=Depends(get_current_user)):
    res = await db.composio_connections.delete_one({"id": cid, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Connection not found")
    await log_audit(user["id"], "composio.disconnect", cid)
    return {"ok": True}


# -----------------------------------------------------------------------------
# ZOHO CRM via Composio
# -----------------------------------------------------------------------------
@api_router.post("/composio/connect/zoho-crm")
async def composio_connect_zoho_crm(user=Depends(get_current_user)):
    """Initiate Zoho CRM OAuth via Composio (US data center, .com)."""
    if not COMPOSIO_API_KEY:
        raise HTTPException(status_code=400, detail="Composio API key missing")

    entity_id = f"workz-{user['id']}"
    redirect_url = f"https://app.composio.dev/connect/zoho_crm?entity={entity_id}"
    composio_connected_id = None

    # Try Composio v3 connect — multiple endpoint shapes for resilience
    try:
        async with httpx.AsyncClient(timeout=12.0) as c:
            r = await c.post(
                f"{COMPOSIO_BASE_URL}/api/v3/connectedAccounts",
                headers={"x-api-key": COMPOSIO_API_KEY, "Content-Type": "application/json"},
                json={
                    "appName": "zoho_crm",
                    "entityId": entity_id,
                    "region": "com",  # US data center
                },
            )
            if r.status_code < 400:
                payload = r.json()
                redirect_url = (
                    payload.get("redirectUrl")
                    or payload.get("redirect_url")
                    or payload.get("url")
                    or redirect_url
                )
                composio_connected_id = (
                    payload.get("id")
                    or payload.get("connectedAccountId")
                    or payload.get("connected_account_id")
                )
            else:
                logger.warning(f"Composio Zoho init non-2xx ({r.status_code}): {r.text[:300]}")
    except Exception as e:
        logger.warning(f"Composio Zoho init failed, using placeholder: {e}")

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "app": "zoho_crm",
        "region": "com",
        "entity_id": entity_id,
        "composio_connected_id": composio_connected_id,
        "status": "pending",
        "redirect_url": redirect_url,
        "created_at": now_utc().isoformat(),
    }
    await db.composio_connections.insert_one(doc)
    await log_audit(user["id"], "composio.connect.zoho_crm", entity_id)
    doc.pop("_id", None)
    return doc


@api_router.post("/composio/zoho/push-lead/{inquiry_id}")
async def push_inquiry_to_zoho(inquiry_id: str, user=Depends(get_current_user)):
    """Seller-only: push a buyer inquiry into Zoho CRM as a Lead via Composio Proxy Execute."""
    if user.get("role") not in ("seller", "admin"):
        raise HTTPException(status_code=403, detail="Sellers/admin only")

    inquiry = await db.inquiries.find_one({"id": inquiry_id, "seller_id": user["id"]}, {"_id": 0})
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")

    conn = await db.composio_connections.find_one(
        {"user_id": user["id"], "app": "zoho_crm"}, {"_id": 0}
    )
    if not conn:
        raise HTTPException(status_code=400, detail="Zoho CRM not connected — connect via Integrations first")

    # Build Zoho Lead record (Insert Records requires {data: [{...}]})
    buyer_name = (inquiry.get("buyer_name") or "Unknown Buyer").strip()
    parts = buyer_name.split(" ", 1)
    first_name = parts[0]
    last_name = parts[1] if len(parts) > 1 else parts[0]
    lead_record = {
        "Last_Name": last_name,
        "First_Name": first_name,
        "Company": inquiry.get("buyer_org") or "Unknown",
        "Email": inquiry.get("buyer_email"),
        "Lead_Source": "Workz Ventures",
        "Description": (
            f"Inquiry re: {inquiry.get('listing_name')}\n\n"
            f"{inquiry.get('message', '')}"
        ),
    }
    body = {"data": [lead_record]}

    # Attempt Composio Proxy Execute
    pushed = False
    composio_response: Dict[str, Any] = {}
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(
                f"{COMPOSIO_BASE_URL}/api/v3/tools/proxy_execute",
                headers={"x-api-key": COMPOSIO_API_KEY, "Content-Type": "application/json"},
                json={
                    "toolkit": "zoho_crm",
                    "connected_account_id": conn.get("composio_connected_id") or conn.get("entity_id"),
                    "method": "POST",
                    "endpoint": "/crm/v8/Leads",
                    "body": body,
                },
            )
            composio_response = {"status_code": r.status_code, "body": r.text[:500]}
            pushed = r.status_code < 400
    except Exception as e:
        composio_response = {"error": str(e)}
        logger.warning(f"Zoho push failed: {e}")

    # Always mark the inquiry as synced locally so the UI reflects the action
    await db.inquiries.update_one(
        {"id": inquiry_id},
        {"$set": {"zoho_pushed_at": now_utc().isoformat(), "zoho_pushed": pushed}},
    )
    await log_audit(user["id"], "zoho.lead.push", inquiry_id, {"pushed": pushed})
    await log_agent_activity(
        "zoho-sync-agent",
        f"push-lead:{inquiry.get('listing_name')}",
        "completed" if pushed else "failed",
        user_id=user["id"],
        friction=None if pushed else "composio_proxy_error",
        meta=composio_response,
    )

    return {
        "ok": True,
        "pushed_to_zoho": pushed,
        "lead": lead_record,
        "composio": composio_response,
        "note": (
            "Pushed to Zoho CRM via Composio Proxy Execute."
            if pushed
            else "Local sync recorded; Composio Proxy Execute did not confirm — verify Zoho Auth Config in Composio dashboard."
        ),
    }


# -----------------------------------------------------------------------------
# DEAL ROOMS (NDA-gated workspace per inquiry · DRL · AI Findings)
# -----------------------------------------------------------------------------
DRL_TEMPLATES = {
    "saas": {
        "id": "saas",
        "name": "SaaS / Software",
        "items": [
            {"title": "Last 3 years P&L by month", "workstream": "finance"},
            {"title": "ARR / MRR cohort schedule (last 24m)", "workstream": "finance"},
            {"title": "Customer concentration (top 20 customers % of revenue)", "workstream": "commercial"},
            {"title": "Net & gross logo retention rates", "workstream": "commercial"},
            {"title": "All material customer contracts > $100k ARR", "workstream": "legal"},
            {"title": "Org chart + comp band schedule", "workstream": "hr"},
            {"title": "Key employee retention/non-compete agreements", "workstream": "hr"},
            {"title": "Stack architecture diagram + cloud spend", "workstream": "it"},
            {"title": "Code repository access + open-source license inventory", "workstream": "it"},
            {"title": "SOC2 / ISO27001 audit reports", "workstream": "it"},
            {"title": "Outstanding litigation & IP assignments", "workstream": "legal"},
        ],
    },
    "healthcare": {
        "id": "healthcare",
        "name": "Healthcare / MedTech",
        "items": [
            {"title": "Payer-mix breakdown last 3 years", "workstream": "finance"},
            {"title": "Reimbursement-rate schedule", "workstream": "finance"},
            {"title": "FDA / CE clearance documentation", "workstream": "legal"},
            {"title": "Clinical trial outcomes + adverse events register", "workstream": "operations"},
            {"title": "HIPAA / GDPR compliance attestation", "workstream": "legal"},
            {"title": "Hospital / GPO contracts portfolio", "workstream": "commercial"},
            {"title": "Manufacturing facility audits", "workstream": "operations"},
            {"title": "Quality system (ISO 13485) documentation", "workstream": "operations"},
            {"title": "Key physician/KOL engagement contracts", "workstream": "legal"},
            {"title": "Cybersecurity / connected-device risk assessment", "workstream": "it"},
        ],
    },
    "industrial": {
        "id": "industrial",
        "name": "Industrial / Manufacturing",
        "items": [
            {"title": "Plant capacity utilization (last 24m)", "workstream": "operations"},
            {"title": "Customer order book / backlog schedule", "workstream": "commercial"},
            {"title": "Supplier concentration & long-term agreements", "workstream": "commercial"},
            {"title": "EHS audits + incident register", "workstream": "operations"},
            {"title": "Environmental permits + remediation liabilities", "workstream": "legal"},
            {"title": "Union agreements + pension obligations", "workstream": "hr"},
            {"title": "Fixed asset register + depreciation schedule", "workstream": "finance"},
            {"title": "Working capital trend (last 36m)", "workstream": "finance"},
            {"title": "Insurance policies + claims history", "workstream": "legal"},
        ],
    },
    "finserv": {
        "id": "finserv",
        "name": "Financial Services",
        "items": [
            {"title": "Regulatory licenses + filings inventory", "workstream": "legal"},
            {"title": "AML/KYC policy + audit results", "workstream": "legal"},
            {"title": "AUM trend + revenue per client", "workstream": "finance"},
            {"title": "Capital adequacy + regulatory capital schedule", "workstream": "finance"},
            {"title": "Client concentration analysis", "workstream": "commercial"},
            {"title": "Custodian / clearing relationships", "workstream": "operations"},
            {"title": "Cybersecurity controls + SOC2 report", "workstream": "it"},
            {"title": "Litigation, regulatory inquiries, fines history", "workstream": "legal"},
        ],
    },
    "climatetech": {
        "id": "climatetech",
        "name": "ClimateTech / Energy",
        "items": [
            {"title": "Project pipeline + commissioning schedule", "workstream": "operations"},
            {"title": "PPA / offtake agreements portfolio", "workstream": "commercial"},
            {"title": "Tax credit eligibility (IRA/CBAM) documentation", "workstream": "finance"},
            {"title": "Permitting status by project", "workstream": "legal"},
            {"title": "Technology IP portfolio + patents", "workstream": "legal"},
            {"title": "Carbon accounting / LCA reports", "workstream": "operations"},
            {"title": "Grid interconnection agreements", "workstream": "legal"},
            {"title": "Capex schedule + financing structure", "workstream": "finance"},
        ],
    },
    "consumer": {
        "id": "consumer",
        "name": "Consumer / Retail",
        "items": [
            {"title": "Channel mix (DTC / wholesale / marketplace)", "workstream": "commercial"},
            {"title": "CAC / LTV by cohort (last 24m)", "workstream": "commercial"},
            {"title": "Inventory aging + obsolescence reserve", "workstream": "finance"},
            {"title": "Brand IP / trademark register", "workstream": "legal"},
            {"title": "Manufacturer / supplier agreements", "workstream": "commercial"},
            {"title": "Returns & warranty obligations", "workstream": "finance"},
            {"title": "Social / earned-media analytics", "workstream": "commercial"},
            {"title": "Sustainability claims + certifications", "workstream": "legal"},
        ],
    },
}


async def participant_check(room: dict, user: dict) -> str:
    """Returns 'buyer' | 'seller' | 'admin' if participant, raises 403 otherwise."""
    if user["id"] == room["buyer_id"]:
        return "buyer"
    if user["id"] == room["seller_id"]:
        return "seller"
    if user.get("role") == "admin":
        return "admin"
    raise HTTPException(status_code=403, detail="Not a participant of this deal room")


@api_router.get("/drl-templates")
async def list_drl_templates(user=Depends(get_current_user)):
    return [{"id": t["id"], "name": t["name"], "item_count": len(t["items"])} for t in DRL_TEMPLATES.values()]


@api_router.post("/inquiries/{inquiry_id}/open-room")
async def open_deal_room(inquiry_id: str, user=Depends(get_current_user)):
    """Seller opens a deal room against an engaged inquiry."""
    if user.get("role") not in ("seller", "admin"):
        raise HTTPException(status_code=403, detail="Sellers/admin only")
    inquiry = await db.inquiries.find_one({"id": inquiry_id, "seller_id": user["id"]}, {"_id": 0})
    if not inquiry:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    if inquiry.get("status") != "engaged":
        raise HTTPException(status_code=400, detail="Inquiry must be 'engaged' before opening a deal room")

    existing = await db.deal_rooms.find_one({"inquiry_id": inquiry_id}, {"_id": 0})
    if existing:
        return existing

    listing = await db.listings.find_one({"id": inquiry["listing_id"]}, {"_id": 0})
    room = {
        "id": str(uuid.uuid4()),
        "inquiry_id": inquiry_id,
        "listing_id": inquiry["listing_id"],
        "listing_name": inquiry["listing_name"],
        "sector": (listing or {}).get("sector"),
        "buyer_id": inquiry["buyer_id"],
        "buyer_name": inquiry["buyer_name"],
        "buyer_org": inquiry.get("buyer_org"),
        "seller_id": inquiry["seller_id"],
        "seller_name": user["name"],
        "seller_org": user.get("organization"),
        "status": "pending_nda",
        "nda_accepted_by_buyer_at": None,
        "drl_template_id": None,
        "created_at": now_utc().isoformat(),
    }
    await db.deal_rooms.insert_one(room)
    await db.inquiries.update_one({"id": inquiry_id}, {"$set": {"deal_room_id": room["id"]}})
    await log_audit(user["id"], "dealroom.open", room["id"], {"listing": inquiry["listing_name"]})
    room.pop("_id", None)
    return room


@api_router.get("/deal-rooms")
async def list_deal_rooms(user=Depends(get_current_user)):
    if user.get("role") == "admin":
        q = {}
    else:
        q = {"$or": [{"buyer_id": user["id"]}, {"seller_id": user["id"]}]}
    rooms = await db.deal_rooms.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    for r in rooms:
        r["files_count"] = await db.deal_room_files.count_documents({"room_id": r["id"]})
        r["findings_count"] = await db.deal_room_findings.count_documents({"room_id": r["id"]})
        r["requests_count"] = await db.deal_room_requests.count_documents({"room_id": r["id"]})
    return rooms


@api_router.get("/deal-rooms/{rid}")
async def get_deal_room(rid: str, user=Depends(get_current_user)):
    room = await db.deal_rooms.find_one({"id": rid}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Deal room not found")
    await participant_check(room, user)
    room["files"] = await db.deal_room_files.find({"room_id": rid}, {"_id": 0, "content": 0}).sort("uploaded_at", -1).to_list(500)
    room["requests"] = await db.deal_room_requests.find({"room_id": rid}, {"_id": 0}).sort("created_at", 1).to_list(200)
    room["findings"] = await db.deal_room_findings.find({"room_id": rid}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return room


@api_router.post("/deal-rooms/{rid}/accept-nda")
async def accept_nda(rid: str, user=Depends(get_current_user)):
    room = await db.deal_rooms.find_one({"id": rid})
    if not room:
        raise HTTPException(status_code=404, detail="Deal room not found")
    if user["id"] != room["buyer_id"]:
        raise HTTPException(status_code=403, detail="Only the buyer can accept the NDA")
    await db.deal_rooms.update_one(
        {"id": rid},
        {"$set": {"status": "active", "nda_accepted_by_buyer_at": now_utc().isoformat()}},
    )
    await log_audit(user["id"], "dealroom.nda.accept", rid)
    return {"ok": True}


@api_router.post("/deal-rooms/{rid}/drl")
async def apply_drl_template(rid: str, body: DRLApply, user=Depends(get_current_user)):
    room = await db.deal_rooms.find_one({"id": rid}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Deal room not found")
    role = await participant_check(room, user)
    if role not in ("buyer", "admin"):
        raise HTTPException(status_code=403, detail="Only the buyer can apply a DRL template")
    template = DRL_TEMPLATES.get(body.template_id)
    if not template:
        raise HTTPException(status_code=400, detail="Unknown template")

    # Clear previous template items
    await db.deal_room_requests.delete_many({"room_id": rid})
    new_docs = [
        {
            "id": str(uuid.uuid4()),
            "room_id": rid,
            "template_id": template["id"],
            "title": item["title"],
            "workstream": item["workstream"],
            "status": "pending",
            "matched_file_ids": [],
            "created_at": now_utc().isoformat(),
        }
        for item in template["items"]
    ]
    if new_docs:
        await db.deal_room_requests.insert_many(new_docs)
    await db.deal_rooms.update_one({"id": rid}, {"$set": {"drl_template_id": template["id"]}})
    await log_audit(user["id"], "dealroom.drl.apply", rid, {"template": template["id"], "count": len(new_docs)})
    return {"ok": True, "request_count": len(new_docs)}


@api_router.post("/deal-rooms/{rid}/files")
async def upload_file(rid: str, body: FileUpload, user=Depends(get_current_user)):
    room = await db.deal_rooms.find_one({"id": rid}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Deal room not found")
    role = await participant_check(room, user)
    if room.get("status") == "pending_nda":
        raise HTTPException(status_code=400, detail="Buyer must accept NDA before files can be exchanged")

    file_id = str(uuid.uuid4())
    doc = {
        "id": file_id,
        "room_id": rid,
        "filename": body.filename,
        "folder": body.folder,
        "content": body.content[:50000],  # cap to 50k chars for safety
        "char_count": len(body.content),
        "note": body.note,
        "uploaded_by": user["id"],
        "uploaded_by_role": role,
        "uploaded_at": now_utc().isoformat(),
        "matched_request_id": None,
    }
    await db.deal_room_files.insert_one(doc)
    await log_audit(user["id"], "dealroom.file.upload", rid, {"filename": body.filename, "folder": body.folder})

    # Best-effort auto-match against DRL items
    matched_request_id = None
    if role in ("seller", "admin"):
        requests = await db.deal_room_requests.find({"room_id": rid, "status": "pending"}, {"_id": 0}).to_list(200)
        if requests:
            try:
                lines = "\n".join(f"[{r['id']}] {r['workstream']} :: {r['title']}" for r in requests[:30])
                prompt = (
                    f"You are an M&A diligence coordinator. A seller uploaded a file titled '{body.filename}' "
                    f"(folder: {body.folder}). First 800 chars of content:\n{body.content[:800]}\n\n"
                    f"Open DRL requests:\n{lines}\n\n"
                    "Return ONLY the id of the single best-matching request (or NONE). Reply with the id and nothing else."
                )
                raw = await call_claude(
                    "You match documents to diligence requests. Reply with exactly one id or NONE.",
                    prompt,
                    session_id=f"match-{rid}",
                )
                raw_clean = (raw or "").strip().split()[0] if raw else ""
                if raw_clean and raw_clean.upper() != "NONE":
                    candidate = next((r for r in requests if r["id"] == raw_clean), None)
                    if candidate:
                        matched_request_id = candidate["id"]
                        await db.deal_room_requests.update_one(
                            {"id": matched_request_id},
                            {
                                "$set": {"status": "satisfied"},
                                "$addToSet": {"matched_file_ids": file_id},
                            },
                        )
                        await db.deal_room_files.update_one(
                            {"id": file_id},
                            {"$set": {"matched_request_id": matched_request_id}},
                        )
                        await log_agent_activity(
                            "drl-match-agent",
                            f"matched:{body.filename}",
                            "completed",
                            user_id=user["id"],
                            meta={"request_id": matched_request_id},
                        )
            except Exception as e:
                logger.warning(f"DRL auto-match failed: {e}")
                await log_agent_activity(
                    "drl-match-agent",
                    f"match:{body.filename}",
                    "failed",
                    user_id=user["id"],
                    friction=str(e),
                )

    doc.pop("_id", None)
    doc.pop("content", None)
    doc["matched_request_id"] = matched_request_id
    return doc


@api_router.post("/deal-rooms/{rid}/generate-findings")
async def generate_findings(rid: str, user=Depends(get_current_user)):
    """AI reads every uploaded file in the room and produces structured findings with citations."""
    room = await db.deal_rooms.find_one({"id": rid}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Deal room not found")
    role = await participant_check(room, user)
    if role not in ("buyer", "admin"):
        raise HTTPException(status_code=403, detail="Only the buyer can generate findings")

    files = await db.deal_room_files.find({"room_id": rid}, {"_id": 0}).sort("uploaded_at", 1).to_list(50)
    if not files:
        raise HTTPException(status_code=400, detail="No files in room yet")

    # Build numbered file inventory + excerpts (cap each at 1500 chars)
    inventory = []
    for idx, f in enumerate(files, start=1):
        excerpt = (f.get("content") or "")[:1500]
        inventory.append(f"[{idx}] file_id={f['id']} · filename={f['filename']} · folder={f['folder']}\n{excerpt}")
    files_block = "\n\n---\n\n".join(inventory)

    sys = """You are a senior M&A diligence analyst. Given a numbered file inventory, produce STRICT JSON findings.
Return: {"findings":[{"severity":"high|medium|low","workstream":"finance|legal|hr|it|operations|commercial","title":str,"description":str,"file_index":int,"excerpt":str}]}
Cap to 10 findings. Each excerpt must be a verbatim short quote (≤200 chars) from the referenced file. Be specific."""

    started = now_utc()
    try:
        raw = await call_claude(sys, f"File inventory:\n\n{files_block}\n\nReturn JSON now.", session_id=f"findings-{rid}")
        data = safe_json_loads(raw)
    except Exception as e:
        await log_agent_activity("findings-agent", f"room:{rid}", "failed", user_id=user["id"], friction=str(e))
        raise HTTPException(status_code=502, detail=f"AI findings failed: {e}")

    findings = data.get("findings", []) if isinstance(data, dict) else []
    inserted = []
    for f in findings[:10]:
        try:
            idx = int(f.get("file_index", 0))
        except Exception:
            idx = 0
        cited_file = files[idx - 1] if 1 <= idx <= len(files) else None
        doc = {
            "id": str(uuid.uuid4()),
            "room_id": rid,
            "severity": f.get("severity", "medium"),
            "workstream": f.get("workstream", "operations"),
            "title": (f.get("title") or "Untitled finding")[:200],
            "description": (f.get("description") or "")[:1000],
            "citation": {
                "file_id": cited_file["id"] if cited_file else None,
                "filename": cited_file["filename"] if cited_file else None,
                "excerpt": (f.get("excerpt") or "")[:240],
            },
            "created_at": now_utc().isoformat(),
        }
        inserted.append(doc)

    if inserted:
        await db.deal_room_findings.insert_many(inserted)
        for d in inserted:
            d.pop("_id", None)

    duration = int((now_utc() - started).total_seconds() * 1000)
    await log_agent_activity(
        "findings-agent",
        f"room:{rid} · {len(inserted)} findings",
        "completed",
        user_id=user["id"],
        duration_ms=duration,
    )
    await log_audit(user["id"], "dealroom.findings.generate", rid, {"count": len(inserted)})
    return {"ok": True, "findings": inserted, "files_analyzed": len(files)}


# -----------------------------------------------------------------------------
# AUDIT
# -----------------------------------------------------------------------------
@api_router.get("/audit/logs")
async def audit_logs(user=Depends(get_current_user)):
    items = await db.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(200)
    return items


# -----------------------------------------------------------------------------
# SEED (demo deals on startup)
# -----------------------------------------------------------------------------
async def seed_demo_user():
    seed_email = "alex@workz.example.com"
    if not await db.users.find_one({"email": seed_email}):
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": seed_email,
            "name": "Alex Buyer",
            "role": "buyer",
            "organization": "Cascade Capital",
            "password_hash": hash_password("WorkzPass123!"),
            "interests": ["SaaS", "EMEA"],
            "newsletter_opt_in": True,
            "newsletter_cadence": "weekly",
            "created_at": now_utc().isoformat(),
        })

    seller_email = "mira@workz.example.com"
    seller = await db.users.find_one({"email": seller_email})
    if not seller:
        seller_id = str(uuid.uuid4())
        await db.users.insert_one({
            "id": seller_id,
            "email": seller_email,
            "name": "Mira Seller",
            "role": "seller",
            "organization": "Northstar Holdings",
            "password_hash": hash_password("WorkzPass123!"),
            "interests": ["HealthTech", "Industrial"],
            "newsletter_opt_in": False,
            "created_at": now_utc().isoformat(),
        })
    else:
        seller_id = seller["id"]

    # Seed sample seller listings if none yet
    if await db.listings.count_documents({"seller_id": seller_id}) == 0:
        sample = [
            {
                "company_name": "Helios MedTech",
                "sector": "HealthTech",
                "geography": "EMEA",
                "asking_price_usd_m": 412.0,
                "revenue_usd_m": 142.0,
                "ebitda_usd_m": 38.0,
                "employees": 320,
                "headline": "Category-leading EU surgical robotics platform",
                "summary": "DACH-dominant surgical robotics with 38% YoY growth and 27% EBITDA margins. Recurring revenue ~62%.",
                "highlights": ["32 hospital systems under contract", "FDA + CE marked", "Founder-led, succession-ready"],
                "status": "live",
            },
            {
                "company_name": "Atlas Logistics",
                "sector": "Industrial",
                "geography": "NA",
                "asking_price_usd_m": 287.0,
                "revenue_usd_m": 318.0,
                "ebitda_usd_m": 54.0,
                "employees": 1240,
                "headline": "Asset-light North-American 3PL with a tech moat",
                "summary": "Tier-1 retail accounts, AI-driven route optimization, 18% EBITDA margins growing.",
                "highlights": ["Top-50 retailer concentration <20%", "Proprietary routing engine", "Cross-dock footprint in 12 cities"],
                "status": "live",
            },
            {
                "company_name": "Vertex Climate",
                "sector": "ClimateTech",
                "geography": "EMEA",
                "asking_price_usd_m": 178.0,
                "revenue_usd_m": 64.0,
                "ebitda_usd_m": 12.0,
                "employees": 180,
                "headline": "Industrial carbon-capture for hard-to-abate sectors",
                "summary": "Patented amine-free capture, two operating plants, €40M backlog.",
                "highlights": ["3 LOI in pipeline", "EU CBAM tailwind", "Founder + CTO contracted to stay 24 months"],
                "status": "draft",
            },
        ]
        await db.listings.insert_many([
            {
                "id": str(uuid.uuid4()),
                "seller_id": seller_id,
                "seller_name": "Mira Seller",
                "seller_org": "Northstar Holdings",
                **s,
                "inquiry_count": 0,
                "view_count": 0,
                "created_at": now_utc().isoformat(),
            } for s in sample
        ])

    # Migrate any legacy analyst-role users to buyer
    await db.users.update_many({"role": "analyst"}, {"$set": {"role": "buyer"}})


@app.on_event("startup")
async def seed_demo():
    await seed_demo_user()
    if await db.deals.count_documents({}) == 0:
        await db.deals.insert_many([
            {"id": str(uuid.uuid4()), "name": "Project Helios", "sector": "Industrial Tech", "stage": "DD", "value_usd_m": 412, "geography": "EMEA", "status": "active", "created_at": now_utc().isoformat()},
            {"id": str(uuid.uuid4()), "name": "Project Atlas", "sector": "SaaS", "stage": "LOI", "value_usd_m": 287, "geography": "NA", "status": "active", "created_at": now_utc().isoformat()},
            {"id": str(uuid.uuid4()), "name": "Project Meridian", "sector": "Healthcare", "stage": "Sourcing", "value_usd_m": 619, "geography": "APAC", "status": "active", "created_at": now_utc().isoformat()},
            {"id": str(uuid.uuid4()), "name": "Project Nautilus", "sector": "FinServ", "stage": "Closing", "value_usd_m": 1240, "geography": "EMEA", "status": "active", "created_at": now_utc().isoformat()},
            {"id": str(uuid.uuid4()), "name": "Project Vertex", "sector": "ClimateTech", "stage": "DD", "value_usd_m": 178, "geography": "NA", "status": "active", "created_at": now_utc().isoformat()},
        ])
    logger.info("Workz Ventures backend ready")


# -----------------------------------------------------------------------------
# Health
# -----------------------------------------------------------------------------
@api_router.get("/")
async def health():
    return {"service": "workz-ventures", "ok": True}


# Register router + middleware
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
