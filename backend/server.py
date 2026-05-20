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
    role: Literal["admin", "buyer", "analyst"] = "buyer"
    organization: Optional[str] = None
    interests: List[str] = Field(default_factory=list)
    newsletter_opt_in: bool = False
    created_at: datetime


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    organization: Optional[str] = None
    role: Literal["admin", "buyer", "analyst"] = "buyer"


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
    return {
        "aum_usd_b": 14.7,
        "active_deals": deals,
        "pipeline_leads": leads,
        "campaigns": campaigns,
        "newsletters_sent": newsletters,
        "research_count": research,
        "agent_success_rate": success_rate,
        "agent_runs": activities,
        "exit_velocity_days": 142,
    }


@api_router.get("/deals")
async def list_deals(user=Depends(get_current_user)):
    deals = await db.deals.find({}, {"_id": 0}).to_list(200)
    return deals


# -----------------------------------------------------------------------------
# RESEARCH HUB
# -----------------------------------------------------------------------------
RESEARCH_SYS = """You are a senior M&A research analyst at Workz Ventures.
Produce a concise, institutional-grade research brief on a company.
ALWAYS return STRICT JSON only (no markdown fences) with this exact schema:
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
Be specific and analytical. Use realistic, plausible details when public data is limited.
"""


@api_router.post("/research/company")
async def research_company(body: CompanyResearchRequest, user=Depends(get_current_user)):
    started = now_utc()
    user_prompt = (
        f"Company: {body.company_name}\n"
        f"Sector hint: {body.sector or 'unspecified'}\n"
        f"Region hint: {body.region or 'global'}\n"
        f"Buyer notes: {body.notes or 'none'}\n"
        "Generate the JSON brief now."
    )
    try:
        raw = await call_claude(RESEARCH_SYS, user_prompt, session_id=f"research-{user['id']}")
        data = safe_json_loads(raw)
    except Exception as e:
        logger.exception("Claude research failed")
        await log_agent_activity("research-agent", f"research:{body.company_name}", "failed",
                                 user_id=user["id"], friction=str(e))
        raise HTTPException(status_code=502, detail=f"AI research failed: {e}")

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "company_name": body.company_name,
        "sector": body.sector,
        "region": body.region,
        "data": data,
        "created_at": now_utc().isoformat(),
    }
    await db.research.insert_one(doc)
    duration = int((now_utc() - started).total_seconds() * 1000)
    await log_agent_activity("research-agent", f"research:{body.company_name}", "completed",
                             user_id=user["id"], duration_ms=duration)
    await log_audit(user["id"], "research.create", body.company_name)
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
    started = now_utc()
    interests = ", ".join(user.get("interests", [])) or "general institutional buyers"
    topic = body.topic or "this week's deal flow and market signals"
    raw = await call_claude(
        NEWSLETTER_SYS,
        f"Subscriber interests: {interests}\nTopic focus: {topic}\nProduce JSON.",
        session_id=f"newsletter-{user['id']}",
    )
    data = safe_json_loads(raw)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "data": data,
        "status": "draft",
        "approved_by": None,
        "dispatched_at": None,
        "recipients": 0,
        "created_at": now_utc().isoformat(),
    }
    await db.newsletters.insert_one(doc)
    duration = int((now_utc() - started).total_seconds() * 1000)
    await log_agent_activity("newsletter-agent", "draft", "completed", user_id=user["id"], duration_ms=duration)
    await log_audit(user["id"], "newsletter.draft", doc["id"])
    doc.pop("_id", None)
    return doc


@api_router.get("/newsletter")
async def list_newsletters(user=Depends(get_current_user)):
    items = await db.newsletters.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
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
    """MOCKED email dispatch (Resend integration mocked per user choice)."""
    nl = await db.newsletters.find_one({"id": nid, "user_id": user["id"]}, {"_id": 0})
    if not nl:
        raise HTTPException(status_code=404, detail="Newsletter not found")
    opted_in = await db.users.count_documents({"newsletter_opt_in": True})
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
        "supported_apps": ["LINKEDIN", "GMAIL", "SLACK", "HUBSPOT", "SALESFORCE"],
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
# AUDIT
# -----------------------------------------------------------------------------
@api_router.get("/audit/logs")
async def audit_logs(user=Depends(get_current_user)):
    items = await db.audit_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(200)
    return items


# -----------------------------------------------------------------------------
# SEED (demo deals on startup)
# -----------------------------------------------------------------------------
@app.on_event("startup")
async def seed_demo():
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
