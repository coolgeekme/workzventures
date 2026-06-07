"""
Smoke tests for the 48-hour demo account data retention policy.
Run: cd /app/backend && pytest tests/test_demo_cleanup.py -q
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://buyer-intel-lab.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

BUYER = {"email": "alex@workz.example.com", "password": "WorkzPass123!"}
SELLER = {"email": "mira@workz.example.com", "password": "WorkzPass123!"}
ADMIN = {"email": "admin@workz.example.com", "password": "WorkzAdmin123!"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.text}"
    return r.json()["token"], r.json()["user"]


def test_demo_users_carry_is_demo_flag():
    for creds in (BUYER, SELLER, ADMIN):
        _, user = _login(creds)
        assert user.get("is_demo") is True, f"{creds['email']} missing is_demo"
        assert user.get("demo_data_retention_hours") == 48


def test_retention_info_endpoint():
    token, _ = _login(BUYER)
    r = requests.get(
        f"{API}/demo/retention-info",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["is_demo"] is True
    assert body["retention_hours"] == 48
    assert "alex@workz.example.com" in body["demo_emails"]
    assert "48" in body["policy"]


def test_admin_only_purge_endpoint():
    # Non-admin (buyer) should be 403
    btoken, _ = _login(BUYER)
    r = requests.post(
        f"{API}/admin/demo/purge",
        headers={"Authorization": f"Bearer {btoken}"},
        timeout=30,
    )
    assert r.status_code == 403

    # Admin should succeed
    atoken, _ = _login(ADMIN)
    r = requests.post(
        f"{API}/admin/demo/purge",
        headers={"Authorization": f"Bearer {atoken}"},
        timeout=60,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["demo_user_count"] == 3
    assert "deleted" in body
    assert "cutoff" in body


def test_seed_listings_survive_purge():
    """After a purge, Mira's 3 pre-seeded listings must still exist."""
    atoken, _ = _login(ADMIN)
    requests.post(
        f"{API}/admin/demo/purge",
        headers={"Authorization": f"Bearer {atoken}"},
        timeout=60,
    )
    # Mira is a seller; list her listings
    stoken, _ = _login(SELLER)
    r = requests.get(
        f"{API}/listings",
        headers={"Authorization": f"Bearer {stoken}"},
        timeout=20,
    )
    assert r.status_code == 200
    names = {li["company_name"] for li in r.json()}
    # All 3 seed companies present
    assert {"Helios MedTech", "Atlas Logistics", "Vertex Climate"}.issubset(names), names


def test_fresh_demo_content_is_not_purged():
    """User-created content from the last 48h must survive the purge sweep."""
    btoken, _ = _login(BUYER)
    # Add a watchlist row (fast, no LLM calls)
    # First we need a listing id (any seed listing works)
    stoken, _ = _login(SELLER)
    r = requests.get(
        f"{API}/listings", headers={"Authorization": f"Bearer {stoken}"}, timeout=20
    )
    seed_lid = r.json()[0]["id"]

    r = requests.post(
        f"{API}/watchlist/{seed_lid}",
        headers={"Authorization": f"Bearer {btoken}"},
        timeout=15,
    )
    # may already exist — accept 200 or 409
    assert r.status_code in (200, 201, 400, 409)

    # Force a purge
    atoken, _ = _login(ADMIN)
    requests.post(
        f"{API}/admin/demo/purge",
        headers={"Authorization": f"Bearer {atoken}"},
        timeout=60,
    )

    # Watchlist row from this second should still be there (created_at is "now")
    r = requests.get(
        f"{API}/watchlist",
        headers={"Authorization": f"Bearer {btoken}"},
        timeout=15,
    )
    assert r.status_code == 200
    ids = {w["listing_id"] for w in r.json()}
    assert seed_lid in ids, "fresh watchlist row was wrongly purged"

    # Cleanup
    requests.delete(
        f"{API}/watchlist/{seed_lid}",
        headers={"Authorization": f"Bearer {btoken}"},
        timeout=15,
    )
