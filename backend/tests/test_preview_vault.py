"""Backend tests for the Preview Vault feature (POST /api/listings/{lid}/preview-vault).

Coverage:
- Seller can open a preview vault on their own listing
- Idempotency: calling again returns the same room id
- Room has status='preview' and is_preview=True
- Banner-supporting GET /api/rooms/{id} returns is_preview
- Preview badge: GET /api/rooms list returns is_preview on preview rooms
- Buyer (no edit access) → 403
- Agent on their own listing → 200 and works
- Regression: GET /api/drl-templates returns 200
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

SELLER = ("mira@workz.example.com", "WorkzPass123!")
BUYER = ("alex@workz.example.com", "WorkzPass123!")
AGENT = ("agent@workz.example.com", "WorkzPass123!")


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def seller_token():
    return _login(*SELLER)


@pytest.fixture(scope="module")
def buyer_token():
    return _login(*BUYER)


@pytest.fixture(scope="module")
def agent_token():
    return _login(*AGENT)


@pytest.fixture(scope="module")
def seller_listing_id(seller_token):
    r = requests.get(f"{BASE_URL}/api/listings", headers=_headers(seller_token), timeout=15)
    assert r.status_code == 200, r.text
    listings = r.json()
    assert len(listings) > 0, "seller should have seed listings"
    return listings[0]["id"]


# ---------- Regression: drl-templates ----------
def test_drl_templates_regression(seller_token):
    r = requests.get(f"{BASE_URL}/api/drl-templates", headers=_headers(seller_token), timeout=15)
    assert r.status_code == 200, f"drl-templates regression: {r.status_code} {r.text}"
    data = r.json()
    assert isinstance(data, list)
    if data:
        assert "id" in data[0] and "name" in data[0]


# ---------- Seller flow ----------
def test_seller_opens_preview_vault(seller_token, seller_listing_id):
    r = requests.post(
        f"{BASE_URL}/api/listings/{seller_listing_id}/preview-vault",
        headers=_headers(seller_token), timeout=20,
    )
    assert r.status_code == 200, f"open preview vault: {r.status_code} {r.text}"
    room = r.json()
    assert room.get("status") == "preview"
    assert room.get("is_preview") is True
    assert room.get("listing_id") == seller_listing_id
    assert "id" in room and isinstance(room["id"], str)
    # Verify the room is fetchable
    g = requests.get(f"{BASE_URL}/api/deal-rooms/{room['id']}", headers=_headers(seller_token), timeout=15)
    assert g.status_code == 200, g.text
    fetched = g.json()
    assert fetched.get("is_preview") is True
    assert fetched.get("status") == "preview"


def test_preview_vault_idempotent(seller_token, seller_listing_id):
    r1 = requests.post(
        f"{BASE_URL}/api/listings/{seller_listing_id}/preview-vault",
        headers=_headers(seller_token), timeout=20,
    )
    r2 = requests.post(
        f"{BASE_URL}/api/listings/{seller_listing_id}/preview-vault",
        headers=_headers(seller_token), timeout=20,
    )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"], "Preview vault should be idempotent (same room id)"


def test_preview_room_appears_in_rooms_list_with_preview_flag(seller_token, seller_listing_id):
    # ensure one exists
    requests.post(
        f"{BASE_URL}/api/listings/{seller_listing_id}/preview-vault",
        headers=_headers(seller_token), timeout=20,
    )
    r = requests.get(f"{BASE_URL}/api/deal-rooms", headers=_headers(seller_token), timeout=15)
    assert r.status_code == 200, r.text
    rooms = r.json()
    preview_rooms = [rm for rm in rooms if rm.get("is_preview") or rm.get("status") == "preview"]
    assert any(rm.get("listing_id") == seller_listing_id for rm in preview_rooms), \
        "the preview vault for the seed listing should appear in /api/rooms"


# ---------- Buyer denied ----------
def test_buyer_denied_403(buyer_token, seller_token, seller_listing_id):
    r = requests.post(
        f"{BASE_URL}/api/listings/{seller_listing_id}/preview-vault",
        headers=_headers(buyer_token), timeout=15,
    )
    assert r.status_code == 403, f"expected 403 for buyer, got {r.status_code} {r.text}"


# ---------- Agent flow ----------
def test_agent_preview_vault(agent_token):
    # Agent may not have a pre-seeded listing — create one
    payload = {
        "company_name": "TEST_PreviewVault_Agent",
        "headline": "preview vault agent test listing",
        "sector": "SaaS",
        "geography": "US",
        "asking_price_usd_m": 10.0,
        "summary": "test listing for preview vault flow",
    }
    cr = requests.post(f"{BASE_URL}/api/listings", json=payload, headers=_headers(agent_token), timeout=15)
    if cr.status_code != 200:
        pytest.skip(f"could not create agent listing: {cr.status_code} {cr.text}")
    lid = cr.json()["id"]
    try:
        r = requests.post(
            f"{BASE_URL}/api/listings/{lid}/preview-vault",
            headers=_headers(agent_token), timeout=20,
        )
        assert r.status_code == 200, f"agent preview vault failed: {r.status_code} {r.text}"
        room = r.json()
        assert room.get("status") == "preview"
        assert room.get("is_preview") is True
    finally:
        requests.delete(f"{BASE_URL}/api/listings/{lid}", headers=_headers(agent_token), timeout=15)
