"""Iter-12 backend tests:
- Buyer Discovery (SEC EDGAR scan + Claude ranking + matches + alerts)
- Newsletter recipient editor (recipient-candidates, hand-picked dispatch)
- Cross-role authorization (buyer 403 on every buyer-discovery / buyer-alerts route)
"""
import os
import time
import pytest
import requests


def _load_backend_url():
    val = os.environ.get("REACT_APP_BACKEND_URL")
    if val:
        return val.rstrip("/")
    # fallback: read from /app/frontend/.env
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

SELLER = {"email": "mira@workz.example.com", "password": "WorkzPass123!"}
BUYER = {"email": "alex@workz.example.com", "password": "WorkzPass123!"}
ADMIN = {"email": "admin@workz.example.com", "password": "WorkzAdmin123!"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ------- Fixtures --------------------------------------------------------------

@pytest.fixture(scope="module")
def seller_token():
    return _login(SELLER)


@pytest.fixture(scope="module")
def buyer_token():
    return _login(BUYER)


@pytest.fixture(scope="module")
def seller_listing(seller_token):
    """Pick a HealthTech/SaaS/Industrial listing owned by Mira."""
    r = requests.get(f"{API}/listings", headers=_h(seller_token), timeout=15)
    assert r.status_code == 200, r.text
    listings = r.json()
    assert isinstance(listings, list) and len(listings) > 0
    # Prefer Helios MedTech (seeded HealthTech) → known to produce matches
    chosen = next((li for li in listings if li.get("company_name") == "Helios MedTech"), None)
    if not chosen:
        chosen = next((li for li in listings if li.get("company_name") == "Atlas Logistics"), None)
    if not chosen:
        for li in listings:
            if not (li.get("company_name") or "").startswith("TEST_"):
                chosen = li
                break
    if not chosen:
        chosen = listings[0]
    return chosen


# ------- Buyer Discovery: scan + matches --------------------------------------

class TestBuyerDiscoveryScan:
    """Run real SEC EDGAR scan and validate the response shape."""

    def test_scan_runs_and_returns_counts(self, seller_token, seller_listing):
        lid = seller_listing["id"]
        r = requests.post(
            f"{API}/buyer-discovery/listings/{lid}/scan",
            headers=_h(seller_token),
            timeout=120,
        )
        assert r.status_code == 200, f"scan failed: {r.status_code} {r.text[:500]}"
        data = r.json()
        for key in ("listing_id", "candidate_count", "ranked_count",
                    "inserted", "new_alerts", "duration_ms"):
            assert key in data, f"missing key {key} in {data}"
        assert data["listing_id"] == lid
        assert isinstance(data["candidate_count"], int)
        assert isinstance(data["ranked_count"], int)
        assert isinstance(data["duration_ms"], int)
        # Persist for downstream tests
        pytest._scan_result = data
        pytest._scan_lid = lid

    def test_overview_includes_listing(self, seller_token, seller_listing):
        r = requests.get(f"{API}/buyer-discovery/overview", headers=_h(seller_token), timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        lids = [row["listing_id"] for row in rows]
        assert seller_listing["id"] in lids
        # Match the row for our listing and confirm fields
        row = next(r for r in rows if r["listing_id"] == seller_listing["id"])
        for k in ("match_count", "company_name", "sector", "geography", "status"):
            assert k in row

    def test_list_matches_sorted_and_shaped(self, seller_token, seller_listing):
        lid = seller_listing["id"]
        r = requests.get(f"{API}/buyer-discovery/listings/{lid}/matches",
                         headers=_h(seller_token), timeout=15)
        assert r.status_code == 200, r.text
        payload = r.json()
        assert "listing" in payload and "matches" in payload and "last_scan" in payload
        matches = payload["matches"]
        if matches:
            # Sorted by score desc
            scores = [m["score"] for m in matches]
            assert scores == sorted(scores, reverse=True)
            m0 = matches[0]
            for k in ("id", "score", "rationale", "fit", "filing_url", "country", "source"):
                assert k in m0, f"match missing {k}: {m0}"
            pytest._match_id = m0["id"]


# ------- Buyer Discovery: actions ---------------------------------------------

class TestBuyerMatchActions:
    def test_patch_status_saved(self, seller_token):
        mid = getattr(pytest, "_match_id", None)
        if not mid:
            pytest.skip("No match available from prior scan")
        r = requests.patch(f"{API}/buyer-discovery/matches/{mid}",
                           headers=_h(seller_token), json={"status": "saved"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "saved"

    def test_add_to_leads_creates_lead(self, seller_token):
        mid = getattr(pytest, "_match_id", None)
        if not mid:
            pytest.skip("No match available")
        r = requests.post(f"{API}/buyer-discovery/matches/{mid}/add-to-leads",
                          headers=_h(seller_token), timeout=20)
        assert r.status_code == 200, r.text
        lead = r.json()
        assert lead.get("source") == "buyer-discovery"
        assert lead.get("buyer_match_id") == mid
        assert "id" in lead
        # Verify match is now status=saved with lead_id
        # (via list matches)
        lid = pytest._scan_lid
        r2 = requests.get(f"{API}/buyer-discovery/listings/{lid}/matches",
                          headers=_h(seller_token), timeout=15)
        m = next((x for x in r2.json()["matches"] if x["id"] == mid), None)
        assert m and m.get("status") == "saved" and m.get("lead_id") == lead["id"]

    def test_generate_outreach_creates_campaign(self, seller_token, seller_listing):
        # Use a second match if available, else reuse
        lid = pytest._scan_lid
        r = requests.get(f"{API}/buyer-discovery/listings/{lid}/matches",
                         headers=_h(seller_token), timeout=15)
        matches = r.json()["matches"]
        if len(matches) < 2:
            pytest.skip("Need at least 2 matches to test outreach without disturbing saved one")
        second = matches[1]
        mid = second["id"]
        r = requests.post(f"{API}/buyer-discovery/matches/{mid}/generate-outreach",
                          headers=_h(seller_token), timeout=30)
        assert r.status_code == 200, r.text
        campaign = r.json()
        assert "id" in campaign
        assert (campaign.get("channel") or "").lower() == "linkedin"
        pytest._outreach_mid = mid

    def test_delete_soft_deletes_match(self, seller_token, seller_listing):
        lid = pytest._scan_lid
        # Find a match that isn't the saved one or the outreach one
        r = requests.get(f"{API}/buyer-discovery/listings/{lid}/matches",
                         headers=_h(seller_token), timeout=15)
        matches = r.json()["matches"]
        protected = {getattr(pytest, "_match_id", None), getattr(pytest, "_outreach_mid", None)}
        target = next((m for m in matches if m["id"] not in protected), None)
        if not target:
            pytest.skip("No expendable match to delete")
        r = requests.delete(f"{API}/buyer-discovery/matches/{target['id']}",
                            headers=_h(seller_token), timeout=15)
        assert r.status_code == 200
        # Verify it disappears from listing
        r2 = requests.get(f"{API}/buyer-discovery/listings/{lid}/matches",
                          headers=_h(seller_token), timeout=15)
        ids_after = [x["id"] for x in r2.json()["matches"]]
        assert target["id"] not in ids_after


# ------- Buyer Alerts ---------------------------------------------------------

class TestBuyerAlerts:
    def test_list_alerts(self, seller_token):
        r = requests.get(f"{API}/buyer-alerts", headers=_h(seller_token), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_count_endpoint(self, seller_token):
        r = requests.get(f"{API}/buyer-alerts/count", headers=_h(seller_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "unseen" in data and isinstance(data["unseen"], int)

    def test_unseen_filter(self, seller_token):
        r = requests.get(f"{API}/buyer-alerts?unseen_only=true",
                         headers=_h(seller_token), timeout=15)
        assert r.status_code == 200
        for a in r.json():
            assert a.get("seen") is False

    def test_mark_one_seen_then_dismiss(self, seller_token):
        r = requests.get(f"{API}/buyer-alerts?unseen_only=true",
                         headers=_h(seller_token), timeout=15)
        alerts = r.json()
        if not alerts:
            pytest.skip("No unseen alerts to act on")
        aid = alerts[0]["id"]
        r1 = requests.patch(f"{API}/buyer-alerts/{aid}/seen",
                            headers=_h(seller_token), timeout=15)
        assert r1.status_code == 200
        r2 = requests.delete(f"{API}/buyer-alerts/{aid}",
                             headers=_h(seller_token), timeout=15)
        assert r2.status_code == 200

    def test_mark_all_seen(self, seller_token):
        r = requests.post(f"{API}/buyer-alerts/mark-all-seen",
                          headers=_h(seller_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "updated" in data
        # Now count should be zero
        c = requests.get(f"{API}/buyer-alerts/count", headers=_h(seller_token), timeout=15)
        assert c.json()["unseen"] == 0


# ------- Authorization: buyer must get 403 -------------------------------------

class TestBuyerForbidden:
    @pytest.mark.parametrize("method,path", [
        ("GET", "/buyer-discovery/overview"),
        ("POST", "/buyer-discovery/listings/abc/scan"),
        ("GET", "/buyer-discovery/listings/abc/matches"),
        ("PATCH", "/buyer-discovery/matches/abc"),
        ("DELETE", "/buyer-discovery/matches/abc"),
        ("POST", "/buyer-discovery/matches/abc/add-to-leads"),
        ("POST", "/buyer-discovery/matches/abc/generate-outreach"),
        ("GET", "/buyer-alerts"),
        ("POST", "/buyer-alerts/mark-all-seen"),
        ("PATCH", "/buyer-alerts/abc/seen"),
        ("DELETE", "/buyer-alerts/abc"),
    ])
    def test_buyer_blocked(self, buyer_token, method, path):
        url = f"{API}{path}"
        kw = {"headers": _h(buyer_token), "timeout": 20}
        if method in ("POST", "PATCH"):
            kw["json"] = {}
        r = requests.request(method, url, **kw)
        assert r.status_code == 403, f"{method} {path} expected 403 got {r.status_code} {r.text[:200]}"

    def test_buyer_alerts_count_returns_zero(self, buyer_token):
        # /buyer-alerts/count is non-403 by design — buyers just get {unseen:0}
        r = requests.get(f"{API}/buyer-alerts/count", headers=_h(buyer_token), timeout=15)
        assert r.status_code == 200
        assert r.json() == {"unseen": 0}


# ------- Newsletter Recipient Editor ------------------------------------------

class TestNewsletterRecipientEditor:
    def test_recipient_candidates_listed_for_seller(self, seller_token):
        r = requests.get(f"{API}/newsletter/recipient-candidates",
                         headers=_h(seller_token), timeout=15)
        assert r.status_code == 200, r.text
        cands = r.json()
        assert isinstance(cands, list)
        # Each must be a buyer with id/email
        for c in cands:
            assert "id" in c and "email" in c
        pytest._cands = cands

    def test_recipient_candidates_blocked_for_buyer(self, buyer_token):
        r = requests.get(f"{API}/newsletter/recipient-candidates",
                         headers=_h(buyer_token), timeout=15)
        assert r.status_code == 403

    def test_edit_recipients_and_dispatch_count_matches(self, seller_token):
        cands = getattr(pytest, "_cands", []) or []
        if not cands:
            pytest.skip("No opted-in buyers available for hand-pick test")

        # 1) Create a fresh draft newsletter
        draft_payload = {
            "title": "TEST_RecipientEditor draft",
            "sectors": ["HealthTech"],
            "content": "Body for recipient-picker test",
        }
        r = requests.post(f"{API}/newsletter/draft",
                          headers=_h(seller_token), json=draft_payload, timeout=60)
        assert r.status_code == 200, r.text
        nl = r.json()
        nid = nl["id"]

        # 2) Pick the first opted-in buyer
        picked_ids = [cands[0]["id"]]
        # 3) Add a fake/non-existent id — should NOT be counted
        picked_ids.append("nonexistent-fake-id-xyz")

        r2 = requests.patch(f"{API}/newsletter/{nid}",
                            headers=_h(seller_token),
                            json={"recipient_ids": picked_ids}, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("recipient_ids") == picked_ids

        # 4) Dispatch — must only count the eligible opted-in buyer
        r3 = requests.post(f"{API}/newsletter/{nid}/dispatch",
                           headers=_h(seller_token), timeout=20)
        assert r3.status_code == 200, r3.text
        out = r3.json()
        assert out.get("recipients") == 1, out
        assert "hand-picked" in (out.get("note") or "")

        # 5) Cleanup: try to delete (dispatched → soft-deleted)
        requests.delete(f"{API}/newsletter/{nid}", headers=_h(seller_token), timeout=10)
