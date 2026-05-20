"""
Workz Ventures backend regression test suite.
Covers: JWT auth, dashboard, deals, research (Claude), collateral, outreach,
leads, newsletter, MCP, agents, composio, audit.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://buyer-intel-lab.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# Unique fresh user per test run (avoid collisions with prior runs)
RUN_TAG = uuid.uuid4().hex[:8]
TEST_EMAIL = f"test_{RUN_TAG}@workz.com"
TEST_PASSWORD = "WorkzPass123!"
TEST_NAME = "Test Buyer"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth(session):
    # Register a fresh user
    r = session.post(f"{API}/auth/register", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD,
        "name": TEST_NAME,
        "organization": "Workz Test",
        "role": "buyer",
    }, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data
    assert data["user"]["email"] == TEST_EMAIL
    return {"token": data["token"], "user": data["user"]}


@pytest.fixture(scope="session")
def authed(session, auth):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth['token']}",
    })
    return s


# ----- Health -----
def test_health(session):
    r = session.get(f"{API}/", timeout=15)
    assert r.status_code == 200
    assert r.json().get("ok") is True


# ----- Auth -----
def test_login_returns_token(session, auth):
    r = session.post(f"{API}/auth/login", json={
        "email": TEST_EMAIL, "password": TEST_PASSWORD
    }, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and len(data["token"]) > 10
    assert data["user"]["email"] == TEST_EMAIL


def test_login_invalid(session):
    r = session.post(f"{API}/auth/login", json={
        "email": TEST_EMAIL, "password": "wrong"
    }, timeout=15)
    assert r.status_code == 401


def test_me_returns_user(authed, auth):
    r = authed.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["email"] == auth["user"]["email"]
    assert data["id"] == auth["user"]["id"]


def test_me_requires_auth(session):
    r = session.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 401


# ----- Dashboard / Deals -----
def test_dashboard_stats(authed):
    r = authed.get(f"{API}/dashboard/stats", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ["aum_usd_b", "active_deals", "pipeline_leads", "campaigns",
              "newsletters_sent", "agent_success_rate"]:
        assert k in d, f"Missing key {k}"
    assert d["aum_usd_b"] == 14.7
    assert isinstance(d["agent_success_rate"], (int, float))


def test_deals_seeded(authed):
    r = authed.get(f"{API}/deals", timeout=15)
    assert r.status_code == 200, r.text
    deals = r.json()
    assert len(deals) >= 5
    names = {d["name"] for d in deals}
    for expected in ["Project Helios", "Project Atlas", "Project Meridian",
                     "Project Nautilus", "Project Vertex"]:
        assert expected in names, f"Missing seeded deal {expected}"


# ----- Research (Claude Sonnet 4.5) -----
@pytest.fixture(scope="session")
def research_brief(authed):
    r = authed.post(f"{API}/research/company",
                    json={"company_name": "Stripe", "sector": "FinServ"},
                    timeout=120)
    assert r.status_code == 200, f"research failed: {r.status_code} {r.text[:500]}"
    return r.json()


def test_research_company_persists(research_brief):
    doc = research_brief
    assert "id" in doc and "data" in doc
    data = doc["data"]
    assert isinstance(data, dict)
    # Expect schema fields populated
    assert "company_name" in data, f"missing company_name: {list(data.keys())}"
    assert "leadership" in data
    assert "market_signals" in data
    assert isinstance(data["leadership"], list)
    assert isinstance(data["market_signals"], list)


def test_research_history(authed, research_brief):
    r = authed.get(f"{API}/research/history", timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    assert any(i["id"] == research_brief["id"] for i in items)


# ----- Collateral -----
def test_collateral_one_pager(authed):
    r = authed.post(f"{API}/collateral/generate", json={
        "asset_type": "one_pager",
        "deal_name": "Project Helios",
        "target_audience": "PE buyers",
        "key_points": "Industrial tech, EMEA, $412M, EBITDA growth",
    }, timeout=120)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["asset_type"] == "one_pager"
    assert isinstance(doc["data"], dict)
    # Either title or headline should be present from Claude
    assert any(k in doc["data"] for k in ["title", "headline", "sections"]), doc["data"]


# ----- Outreach (draft -> launch MOCKED) -----
@pytest.fixture(scope="session")
def campaign(authed):
    r = authed.post(f"{API}/outreach/campaigns", json={
        "name": "Test Campaign",
        "target_persona": "VP of Corporate Development at mid-market SaaS",
        "channel": "linkedin",
        "audience_size": 25,
        "message_brief": "Introduce Workz secondary buyout fund",
    }, timeout=120)
    assert r.status_code == 200, r.text
    return r.json()


def test_campaign_drafted(campaign):
    assert campaign["status"] == "draft"
    assert isinstance(campaign["draft"], dict)


def test_campaign_launch(authed, campaign):
    cid = campaign["id"]
    r = authed.post(f"{API}/outreach/campaigns/{cid}/launch", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("ok") is True
    assert d.get("sent_count") == campaign["audience_size"]
    # verify status flip persisted
    r2 = authed.get(f"{API}/outreach/campaigns", timeout=15)
    assert r2.status_code == 200
    rec = next(c for c in r2.json() if c["id"] == cid)
    assert rec["status"] == "launched"


# ----- Leads -----
def test_lead_create_and_advance(authed):
    r = authed.post(f"{API}/leads", json={
        "name": "TEST_Lead Person",
        "company": "Acme Inc",
        "title": "Head of M&A",
        "email": "lead@example.com",
        "source": "manual",
    }, timeout=15)
    assert r.status_code == 200, r.text
    lead = r.json()
    assert lead["stage"] == "new"
    lid = lead["id"]
    r2 = authed.patch(f"{API}/leads/{lid}/stage", json={"stage": "qualified"}, timeout=15)
    assert r2.status_code == 200, r2.text
    # verify persisted
    r3 = authed.get(f"{API}/leads", timeout=15)
    rec = next(l for l in r3.json() if l["id"] == lid)
    assert rec["stage"] == "qualified"


# ----- Newsletter -----
def test_newsletter_preferences(authed):
    r = authed.post(f"{API}/newsletter/preferences", json={
        "opt_in": True,
        "interests": ["SaaS", "FinServ"],
        "cadence": "weekly",
    }, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True
    g = authed.get(f"{API}/newsletter/preferences", timeout=15)
    assert g.status_code == 200
    prefs = g.json()
    assert prefs["opt_in"] is True
    assert "SaaS" in prefs["interests"]
    assert prefs["cadence"] == "weekly"


@pytest.fixture(scope="session")
def newsletter(authed):
    r = authed.post(f"{API}/newsletter/draft", json={"topic": "Q1 deal flow"}, timeout=120)
    assert r.status_code == 200, r.text
    return r.json()


def test_newsletter_draft(newsletter):
    assert newsletter["status"] == "draft"
    assert isinstance(newsletter["data"], dict)


def test_newsletter_approve_and_dispatch(authed, newsletter):
    nid = newsletter["id"]
    r = authed.post(f"{API}/newsletter/{nid}/approve", timeout=15)
    assert r.status_code == 200, r.text
    r2 = authed.post(f"{API}/newsletter/{nid}/dispatch", timeout=15)
    assert r2.status_code == 200, r2.text
    d = r2.json()
    assert d["ok"] is True
    assert "recipients" in d
    # confirm status persisted
    r3 = authed.get(f"{API}/newsletter", timeout=15)
    rec = next(n for n in r3.json() if n["id"] == nid)
    assert rec["status"] == "dispatched"


# ----- MCP -----
def test_mcp_actions(authed):
    r = authed.get(f"{API}/mcp/actions", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["count"] == 9
    assert len(d["actions"]) == 9


def test_mcp_manifest_public(session):
    r = session.get(f"{API}/mcp/manifest", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["name"] == "Workz Ventures MCP"
    assert isinstance(d["actions"], list) and len(d["actions"]) == 9


# ----- Agents -----
def test_agents_activity(authed):
    r = authed.get(f"{API}/agents/activity", timeout=15)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


def test_agents_stats(authed):
    r = authed.get(f"{API}/agents/stats", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ["total", "completed", "failed", "success_rate", "by_agent"]:
        assert k in d


# ----- Composio -----
def test_composio_status(authed):
    r = authed.get(f"{API}/composio/status", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["configured"] is True
    assert "LINKEDIN" in d["supported_apps"]


def test_composio_connect_linkedin(authed):
    r = authed.post(f"{API}/composio/connect/linkedin", timeout=20)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["app"] == "linkedin"
    assert "redirect_url" in doc
    assert doc["status"] == "pending"


# ----- Audit -----
def test_audit_logs(authed):
    r = authed.get(f"{API}/audit/logs", timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    assert isinstance(items, list)
    assert len(items) >= 1
    # auth.register and auth.login should exist
    actions = {i["action"] for i in items}
    assert "auth.register" in actions
