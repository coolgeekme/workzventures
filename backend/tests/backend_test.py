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


def test_seeded_alex_user_login(session):
    """Verify startup-seeded demo user alex@workz.example.com can login."""
    r = session.post(f"{API}/auth/login", json={
        "email": "alex@workz.example.com",
        "password": "WorkzPass123!",
    }, timeout=15)
    assert r.status_code == 200, f"Seed user login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and len(data["token"]) > 10
    assert data["user"]["email"] == "alex@workz.example.com"
    assert data["user"]["role"] == "buyer"


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
def test_dashboard_stats_buyer(authed):
    """Buyer role returns buyer-specific dashboard fields."""
    r = authed.get(f"{API}/dashboard/stats", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["role"] == "buyer"
    for k in ["marketplace_listings", "my_research_count", "my_inquiries",
              "watchlist_count", "newsletters_received", "aum_usd_b",
              "agent_success_rate", "exit_velocity_days"]:
        assert k in d, f"Missing buyer key {k}"
    assert d["aum_usd_b"] == 14.7
    # Buyer-specific fields should NOT contain seller fields
    assert "my_listings" not in d
    assert "inbound_inquiries" not in d


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


# ----- Grounded research (Brave + Perplexity Sonar Pro) -----
@pytest.fixture(scope="session")
def klarna_brief(authed):
    """Run a fresh grounded research call for Klarna and measure latency."""
    started = time.time()
    r = authed.post(f"{API}/research/company",
                    json={"company_name": "Klarna", "sector": "FinTech"},
                    timeout=90)
    elapsed = time.time() - started
    assert r.status_code == 200, f"klarna research failed: {r.status_code} {r.text[:500]}"
    payload = r.json()
    payload["_elapsed_s"] = elapsed
    return payload


def test_grounded_research_has_sources_array(klarna_brief):
    """Response must include numbered `sources` array with provider tags."""
    assert "sources" in klarna_brief, "response missing `sources` array"
    sources = klarna_brief["sources"]
    assert isinstance(sources, list), "`sources` must be a list"
    assert len(sources) >= 5, f"expected >=5 sources for Klarna, got {len(sources)}"
    providers = set()
    for idx, s in enumerate(sources):
        assert isinstance(s, dict), f"source {idx} not a dict"
        assert "index" in s and isinstance(s["index"], int), f"source {idx} missing/invalid index"
        assert "url" in s and isinstance(s["url"], str) and s["url"].startswith("http"), \
            f"source {idx} missing/invalid url: {s.get('url')}"
        assert "provider" in s and s["provider"] in ("perplexity", "brave"), \
            f"source {idx} invalid provider: {s.get('provider')}"
        providers.add(s["provider"])
    # Sources are 1-indexed and contiguous
    indices = [s["index"] for s in sources]
    assert indices == list(range(1, len(sources) + 1)), f"sources not 1..n contiguous: {indices}"
    # We expect both providers to contribute when keys are set
    assert "perplexity" in providers or "brave" in providers, \
        f"expected at least one of perplexity/brave, got {providers}"


def test_grounded_research_live_flag(klarna_brief):
    """`live_research_used` must be True when Brave+Perplexity keys are present."""
    assert klarna_brief.get("live_research_used") is True, \
        f"expected live_research_used=True, got {klarna_brief.get('live_research_used')}"


def test_grounded_research_latency_under_60s(klarna_brief):
    elapsed = klarna_brief.get("_elapsed_s", 0)
    assert elapsed < 60, f"research latency {elapsed:.1f}s exceeds 60s budget"


def test_grounded_research_inline_citations(klarna_brief):
    """Brief text fields should reference [n] citations inline."""
    import re
    data = klarna_brief.get("data") or {}
    # Collect any string content from market_signals + investor_take + one_liner
    text_blobs = []
    ms = data.get("market_signals")
    if isinstance(ms, list):
        for item in ms:
            if isinstance(item, str):
                text_blobs.append(item)
            elif isinstance(item, dict):
                text_blobs.extend(str(v) for v in item.values() if isinstance(v, str))
    it = data.get("investor_take")
    if isinstance(it, str):
        text_blobs.append(it)
    elif isinstance(it, dict):
        text_blobs.extend(str(v) for v in it.values() if isinstance(v, str))
    if isinstance(data.get("one_liner"), str):
        text_blobs.append(data["one_liner"])
    combined = " \n ".join(text_blobs)
    citation_re = re.compile(r"\[\d+\]")
    found = citation_re.findall(combined)
    assert found, (
        f"expected at least one [n] inline citation across market_signals/investor_take/one_liner; "
        f"got none. combined sample: {combined[:400]!r}"
    )


def test_grounded_research_schema_backward_compat(klarna_brief):
    """Older schema fields must still be present even with grounded enrichment."""
    data = klarna_brief.get("data") or {}
    assert isinstance(data, dict)
    assert "company_name" in data, f"missing company_name. keys={list(data.keys())}"
    assert "leadership" in data and isinstance(data["leadership"], list)
    assert "market_signals" in data and isinstance(data["market_signals"], list)


def test_grounded_research_persists_with_sources(authed, klarna_brief):
    """The new fields must survive a GET /api/research/history round-trip."""
    r = authed.get(f"{API}/research/history", timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    match = next((i for i in items if i["id"] == klarna_brief["id"]), None)
    assert match is not None, "klarna brief not present in history"
    assert "sources" in match and isinstance(match["sources"], list) and len(match["sources"]) >= 5
    assert match.get("live_research_used") is True


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
    # iter-5: /draft now tags kind='broadcast' and stamps sender_name/org for any role
    assert newsletter.get("kind") == "broadcast", f"expected kind='broadcast', got {newsletter.get('kind')}"
    assert newsletter.get("sender_name") == TEST_NAME
    assert newsletter.get("sender_org") == "Workz Test"
    assert newsletter.get("recipients") == 0


def test_newsletter_approve_and_dispatch(authed, newsletter):
    nid = newsletter["id"]
    r = authed.post(f"{API}/newsletter/{nid}/approve", timeout=15)
    assert r.status_code == 200, r.text
    r2 = authed.post(f"{API}/newsletter/{nid}/dispatch", timeout=15)
    assert r2.status_code == 200, r2.text
    d = r2.json()
    assert d["ok"] is True
    assert "recipients" in d
    # iter-5: dispatched broadcast recipients = count of role='buyer' AND newsletter_opt_in=true
    # The seeded buyer alex is opted-in by default, so we expect >=1.
    assert isinstance(d["recipients"], int) and d["recipients"] >= 1, (
        f"broadcast dispatch should count at least the seeded opted-in buyer, got {d['recipients']}"
    )
    # confirm status persisted
    r3 = authed.get(f"{API}/newsletter", timeout=15)
    rec = next(n for n in r3.json() if n["id"] == nid)
    assert rec["status"] == "dispatched"
    # iter-5: GET /api/newsletter must surface 'kind' so frontend can filter
    assert rec.get("kind") == "broadcast"


# ----- Newsletter (iter-5): Personal digest (buyer) -----
@pytest.fixture(scope="session")
def personal_newsletter(buyer_authed):
    """Buyer self-service personal digest — drafted AND dispatched in one round trip."""
    r = buyer_authed.post(
        f"{API}/newsletter/personal",
        json={"topic": "weekly portfolio digest"},
        timeout=120,
    )
    assert r.status_code == 200, f"/newsletter/personal failed: {r.status_code} {r.text}"
    return r.json()


def test_newsletter_personal_attributes(personal_newsletter):
    """POST /api/newsletter/personal returns kind='personal', status='dispatched',
    recipients=1, recipient_email=user's email, sender_name='Workz Ventures' — in ONE call."""
    nl = personal_newsletter
    assert nl.get("kind") == "personal", f"expected kind='personal', got {nl.get('kind')}"
    assert nl.get("status") == "dispatched", f"personal must be dispatched immediately, got {nl.get('status')}"
    assert nl.get("recipients") == 1, f"personal recipients must be 1, got {nl.get('recipients')}"
    assert nl.get("recipient_email") == BUYER_EMAIL, (
        f"recipient_email must be the buyer's email, got {nl.get('recipient_email')}"
    )
    assert nl.get("sender_name") == "Workz Ventures"
    assert nl.get("sender_org") == "Workz Ventures"
    assert nl.get("dispatched_at"), "personal digest must have dispatched_at set"
    assert isinstance(nl.get("data"), dict) and nl["data"], "personal digest must carry generated content"


def test_newsletter_personal_dispatch_short_circuits(buyer_authed, personal_newsletter):
    """POST /api/newsletter/{id}/dispatch on a personal newsletter must short-circuit:
    {ok:true, recipients:1, note:'personal digest already delivered'} — no re-dispatch."""
    nid = personal_newsletter["id"]
    r = buyer_authed.post(f"{API}/newsletter/{nid}/dispatch", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("ok") is True
    assert d.get("recipients") == 1
    assert d.get("note") == "personal digest already delivered", (
        f"expected short-circuit note, got {d.get('note')!r}"
    )


def test_newsletter_list_includes_kind_for_personal(buyer_authed, personal_newsletter):
    """GET /api/newsletter must surface the 'kind' field for both personal and broadcast docs."""
    r = buyer_authed.get(f"{API}/newsletter", timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    assert isinstance(items, list) and items, "buyer should see at least their personal newsletter"
    matched = next((n for n in items if n["id"] == personal_newsletter["id"]), None)
    assert matched is not None, "personal newsletter not found in user-scoped list"
    assert matched.get("kind") == "personal"
    assert matched.get("status") == "dispatched"
    assert matched.get("recipients") == 1
    # NB: legacy newsletter docs created prior to iter-5 (before the 'kind' field existed)
    # may still be present in alex's inbox; we only assert the contract on newly-created
    # docs. See test_report for the legacy-backfill recommendation.


# ----- Newsletter (iter-5): Seller broadcast + buyer-only recipient filter -----
@pytest.fixture(scope="session")
def seller_broadcast(seller_authed):
    """Seller drafts a broadcast newsletter (kind='broadcast', status='draft', recipients=0).
    Stamped with seller's name/org."""
    r = seller_authed.post(
        f"{API}/newsletter/draft",
        json={"topic": "Helios MedTech process update for institutional buyers"},
        timeout=120,
    )
    assert r.status_code == 200, f"seller /newsletter/draft failed: {r.status_code} {r.text}"
    return r.json()


def test_seller_broadcast_attributes(seller_broadcast):
    """Seller draft is kind='broadcast', status='draft', recipients=0,
    sender_name/sender_org reflect the SELLER's identity (not Workz Ventures)."""
    nl = seller_broadcast
    assert nl.get("kind") == "broadcast"
    assert nl.get("status") == "draft"
    assert nl.get("recipients") == 0
    # Seller is mira @ Northstar Holdings per /app/memory/test_credentials.md
    assert nl.get("sender_name"), "seller broadcast must stamp sender_name"
    assert nl.get("sender_org") == "Northstar Holdings", (
        f"expected sender_org='Northstar Holdings', got {nl.get('sender_org')!r}"
    )
    assert "Workz Ventures" not in (nl.get("sender_name") or ""), (
        "broadcast sender_name must be the seller, not Workz Ventures"
    )


def test_broadcast_recipients_filter_buyer_role_only(seller_authed, seller_broadcast):
    """Dispatching a broadcast must count ONLY users with role='buyer' AND newsletter_opt_in=true.
    A seller who opts-in must NOT increment the recipients count."""
    nid = seller_broadcast["id"]

    # Baseline: ensure mira (seller) is OPTED OUT, then dispatch
    opt_out = seller_authed.post(
        f"{API}/newsletter/preferences",
        json={"opt_in": False, "interests": [], "cadence": "weekly"},
        timeout=15,
    )
    assert opt_out.status_code == 200, opt_out.text
    r1 = seller_authed.post(f"{API}/newsletter/{nid}/dispatch", timeout=15)
    assert r1.status_code == 200, r1.text
    count_without_seller = r1.json().get("recipients")
    assert isinstance(count_without_seller, int) and count_without_seller >= 1, (
        f"expected >=1 opted-in buyer in the seed (alex), got {count_without_seller}"
    )

    # Now opt mira (seller) IN and re-dispatch
    opt_in = seller_authed.post(
        f"{API}/newsletter/preferences",
        json={"opt_in": True, "interests": ["SaaS"], "cadence": "weekly"},
        timeout=15,
    )
    assert opt_in.status_code == 200, opt_in.text
    r2 = seller_authed.post(f"{API}/newsletter/{nid}/dispatch", timeout=15)
    assert r2.status_code == 200, r2.text
    count_with_seller = r2.json().get("recipients")

    # Cleanup: restore mira to opted-out (matches credentials doc default)
    seller_authed.post(
        f"{API}/newsletter/preferences",
        json={"opt_in": False, "interests": [], "cadence": "weekly"},
        timeout=15,
    )

    assert count_with_seller == count_without_seller, (
        f"BROADCAST FILTER BUG: seller opt-in changed recipient count "
        f"(without_seller={count_without_seller}, with_seller={count_with_seller}). "
        "Dispatch must filter by role='buyer' AND newsletter_opt_in=true."
    )


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


# =============================================================================
# Role differentiation: Buyer vs Seller workspaces
# =============================================================================

SELLER_EMAIL = "mira@workz.example.com"
SELLER_PASSWORD = "WorkzPass123!"
BUYER_EMAIL = "alex@workz.example.com"
BUYER_PASSWORD = "WorkzPass123!"


@pytest.fixture(scope="session")
def seller_authed():
    """Logged-in session for the seed seller mira@workz.example.com."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login",
               json={"email": SELLER_EMAIL, "password": SELLER_PASSWORD},
               timeout=15)
    assert r.status_code == 200, f"seller login failed: {r.text}"
    data = r.json()
    assert data["user"]["role"] == "seller"
    s.headers["Authorization"] = f"Bearer {data['token']}"
    return s


@pytest.fixture(scope="session")
def buyer_authed():
    """Logged-in session for the seed buyer alex@workz.example.com."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login",
               json={"email": BUYER_EMAIL, "password": BUYER_PASSWORD},
               timeout=15)
    assert r.status_code == 200, f"buyer login failed: {r.text}"
    data = r.json()
    assert data["user"]["role"] == "buyer"
    s.headers["Authorization"] = f"Bearer {data['token']}"
    return s


# ----- Seed seller login + role -----
def test_seeded_seller_login(seller_authed):
    r = seller_authed.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["email"] == SELLER_EMAIL
    assert d["role"] == "seller"
    assert d["organization"] == "Northstar Holdings"


# ----- Register accepts role='seller' -----
def test_register_accepts_seller_role(session):
    email = f"seller_{uuid.uuid4().hex[:8]}@workz.com"
    r = session.post(f"{API}/auth/register", json={
        "email": email,
        "password": "WorkzPass123!",
        "name": "Seller Test",
        "organization": "Test Sellers Ltd",
        "role": "seller",
    }, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["role"] == "seller"


# ----- Dashboard stats: seller role payload -----
def test_dashboard_stats_seller(seller_authed):
    r = seller_authed.get(f"{API}/dashboard/stats", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["role"] == "seller"
    for k in ["my_listings", "live_listings", "inbound_inquiries",
              "pipeline_value_usd_m", "my_campaigns", "my_leads",
              "my_newsletters", "agent_success_rate", "agent_runs"]:
        assert k in d, f"Missing seller key {k}"
    # Seeded seller has 3 listings, 2 live
    assert d["my_listings"] >= 3
    assert d["live_listings"] >= 2
    # No buyer-specific fields leak in
    assert "marketplace_listings" not in d
    assert "watchlist_count" not in d


# ----- Listings: seed listings -----
def test_seller_listings_seeded(seller_authed):
    r = seller_authed.get(f"{API}/listings", timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    names = {x["company_name"] for x in items}
    for expected in ["Helios MedTech", "Atlas Logistics", "Vertex Climate"]:
        assert expected in names, f"missing seeded listing {expected}"
    # Vertex Climate should be draft, others live
    helios = next(x for x in items if x["company_name"] == "Helios MedTech")
    vertex = next(x for x in items if x["company_name"] == "Vertex Climate")
    assert helios["status"] == "live"
    assert vertex["status"] == "draft"


# ----- POST /api/listings: seller allowed -----
def test_seller_create_listing(seller_authed):
    payload = {
        "company_name": f"TEST_Acme_{uuid.uuid4().hex[:6]}",
        "sector": "SaaS",
        "geography": "NA",
        "asking_price_usd_m": 125.5,
        "revenue_usd_m": 40.0,
        "ebitda_usd_m": 8.0,
        "employees": 90,
        "headline": "Vertical SaaS leader",
        "summary": "ARR $40M, 35% margins.",
        "highlights": ["Net retention 122%", "Founder-led"],
        "status": "live",
    }
    r = seller_authed.post(f"{API}/listings", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["company_name"] == payload["company_name"]
    assert doc["status"] == "live"
    assert "_id" not in doc
    # Verify via GET
    r2 = seller_authed.get(f"{API}/listings", timeout=15)
    assert any(x["id"] == doc["id"] for x in r2.json())


# ----- POST /api/listings: buyer forbidden -----
def test_buyer_cannot_create_listing(buyer_authed):
    r = buyer_authed.post(f"{API}/listings", json={
        "company_name": "TEST_BlockedBuyerListing",
        "sector": "SaaS",
        "geography": "NA",
        "asking_price_usd_m": 99.0,
        "headline": "Should be blocked",
        "summary": "Blocked",
        "status": "draft",
    }, timeout=15)
    assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


# ----- PATCH listing only own -----
def test_seller_patch_and_delete_own_listing(seller_authed):
    # create
    create = seller_authed.post(f"{API}/listings", json={
        "company_name": f"TEST_Patch_{uuid.uuid4().hex[:6]}",
        "sector": "FinServ",
        "geography": "EMEA",
        "asking_price_usd_m": 50.0,
        "headline": "patchable",
        "summary": "tmp",
        "status": "draft",
    }, timeout=15)
    assert create.status_code == 200
    lid = create.json()["id"]
    # patch
    patched = seller_authed.patch(f"{API}/listings/{lid}", json={
        "company_name": create.json()["company_name"],
        "sector": "FinServ",
        "geography": "EMEA",
        "asking_price_usd_m": 75.0,  # changed
        "headline": "patched headline",
        "summary": "patched summary",
        "status": "live",
    }, timeout=15)
    assert patched.status_code == 200, patched.text
    # verify
    items = seller_authed.get(f"{API}/listings", timeout=15).json()
    rec = next(x for x in items if x["id"] == lid)
    assert rec["asking_price_usd_m"] == 75.0
    assert rec["status"] == "live"
    # delete
    d = seller_authed.delete(f"{API}/listings/{lid}", timeout=15)
    assert d.status_code == 200
    items2 = seller_authed.get(f"{API}/listings", timeout=15).json()
    assert all(x["id"] != lid for x in items2)


# ----- Marketplace: all logged-in users see live listings -----
def test_marketplace_visible_to_buyer(buyer_authed):
    r = buyer_authed.get(f"{API}/marketplace", timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    # Should contain seller's 2 live listings (Helios + Atlas) at minimum
    names = {x["company_name"] for x in items}
    assert "Helios MedTech" in names
    assert "Atlas Logistics" in names
    # Vertex Climate is draft — must NOT appear in marketplace
    assert "Vertex Climate" not in names
    # All listings must be status=live
    assert all(x["status"] == "live" for x in items)


# ----- Marketplace detail increments view_count -----
def test_marketplace_detail(buyer_authed):
    listings = buyer_authed.get(f"{API}/marketplace", timeout=15).json()
    target = next(x for x in listings if x["company_name"] == "Helios MedTech")
    r = buyer_authed.get(f"{API}/marketplace/{target['id']}", timeout=15)
    assert r.status_code == 200
    assert r.json()["company_name"] == "Helios MedTech"


# ----- Inquiry creation: buyer -> seller -----
@pytest.fixture(scope="session")
def buyer_inquiry(buyer_authed):
    listings = buyer_authed.get(f"{API}/marketplace", timeout=15).json()
    target = next(x for x in listings if x["company_name"] == "Atlas Logistics")
    before = target.get("inquiry_count", 0)
    r = buyer_authed.post(f"{API}/marketplace/{target['id']}/inquire",
                          json={"message": "Interested in DD package for Atlas."},
                          timeout=15)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["listing_id"] == target["id"]
    assert doc["status"] == "new"
    # verify inquiry_count incremented
    detail = buyer_authed.get(f"{API}/marketplace/{target['id']}", timeout=15).json()
    assert detail["inquiry_count"] >= before + 1
    return doc


def test_buyer_inquiry_created(buyer_inquiry):
    assert "id" in buyer_inquiry
    assert buyer_inquiry["status"] == "new"


# ----- Buyer outbound inquiries -----
def test_buyer_outbound_inquiries(buyer_authed, buyer_inquiry):
    r = buyer_authed.get(f"{API}/inquiries", timeout=15)
    assert r.status_code == 200
    items = r.json()
    assert any(i["id"] == buyer_inquiry["id"] for i in items)
    # all returned items should belong to this buyer
    # we don't have buyer_id easily, but each should at least reference buyer's listing_id
    assert all("listing_id" in i for i in items)


# ----- Seller inbound inquiries -----
def test_seller_sees_inbound_inquiry(seller_authed, buyer_inquiry):
    r = seller_authed.get(f"{API}/inquiries", timeout=15)
    assert r.status_code == 200
    items = r.json()
    assert any(i["id"] == buyer_inquiry["id"] for i in items)


# ----- PATCH /api/inquiries/{id}/status -----
def test_seller_patch_inquiry_status(seller_authed, buyer_inquiry):
    iid = buyer_inquiry["id"]
    r = seller_authed.patch(f"{API}/inquiries/{iid}/status",
                            json={"status": "reviewing"}, timeout=15)
    assert r.status_code == 200, r.text
    # verify persisted
    items = seller_authed.get(f"{API}/inquiries", timeout=15).json()
    rec = next(i for i in items if i["id"] == iid)
    assert rec["status"] == "reviewing"


def test_seller_patch_inquiry_invalid_status(seller_authed, buyer_inquiry):
    r = seller_authed.patch(f"{API}/inquiries/{buyer_inquiry['id']}/status",
                            json={"status": "BOGUS_STATUS"}, timeout=15)
    assert r.status_code == 400


def test_buyer_cannot_patch_inquiry_status(buyer_authed, buyer_inquiry):
    """Buyer can't patch inquiry — endpoint scopes by seller_id, so 404."""
    r = buyer_authed.patch(f"{API}/inquiries/{buyer_inquiry['id']}/status",
                           json={"status": "passed"}, timeout=15)
    assert r.status_code == 404


# ----- Watchlist CRUD -----
def test_watchlist_add_get_delete(buyer_authed):
    listings = buyer_authed.get(f"{API}/marketplace", timeout=15).json()
    target = next(x for x in listings if x["company_name"] == "Helios MedTech")
    lid = target["id"]
    # add
    r = buyer_authed.post(f"{API}/watchlist/{lid}", timeout=15)
    assert r.status_code == 200, r.text
    # add idempotently
    r2 = buyer_authed.post(f"{API}/watchlist/{lid}", timeout=15)
    assert r2.status_code == 200
    # list
    items = buyer_authed.get(f"{API}/watchlist", timeout=15).json()
    assert any(x["listing_id"] == lid for x in items)
    # delete
    d = buyer_authed.delete(f"{API}/watchlist/{lid}", timeout=15)
    assert d.status_code == 200
    items2 = buyer_authed.get(f"{API}/watchlist", timeout=15).json()
    assert all(x["listing_id"] != lid for x in items2)


def test_watchlist_unknown_listing(buyer_authed):
    r = buyer_authed.post(f"{API}/watchlist/nonexistent-id", timeout=15)
    assert r.status_code == 404
