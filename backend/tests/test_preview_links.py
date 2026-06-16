"""
End-to-end pytest for public preview links on listings.

Run:
    cd /app/backend && PYTHONPATH=. python -m pytest tests/test_preview_links.py -v
"""
import os
import uuid
import requests

API = os.environ.get(
    "TEST_API_URL",
    "https://buyer-intel-lab.preview.emergentagent.com/api",
)
SELLER = ("mira@workz.example.com", "WorkzPass123!")
BUYER = ("alex@workz.example.com", "WorkzPass123!")


def _login(creds):
    r = requests.post(f"{API}/auth/login", json={"email": creds[0], "password": creds[1]}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def _create_listing(tok):
    r = requests.post(
        f"{API}/listings",
        json={
            "company_name": f"Preview Co {uuid.uuid4().hex[:5]}",
            "sector": "SaaS", "geography": "NA", "asking_price_usd_m": 12,
            "headline": "T", "summary": "T", "status": "draft",
        },
        headers=_h(tok),
    )
    r.raise_for_status()
    return r.json()["id"]


def test_create_list_view_public_revoke():
    tok = _login(SELLER)
    lid = _create_listing(tok)
    try:
        # Create link
        r = requests.post(
            f"{API}/listings/{lid}/preview-links",
            json={"label": "for John", "expires_hours": 24},
            headers=_h(tok),
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["label"] == "for John"
        assert "token" in d and "url" in d
        token = d["token"]
        plid = d["id"]

        # Public read works without auth
        r = requests.get(f"{API}/preview/listings/{token}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "listing" in body and "data_room" in body and "preview" in body
        # Sanitised — no seller_id, no inquiry counts
        assert "seller_id" not in body["listing"]
        assert "inquiry_count" not in body["listing"]

        # List shows the link (without the token leaking)
        r = requests.get(f"{API}/listings/{lid}/preview-links", headers=_h(tok))
        assert r.status_code == 200
        rows = r.json()
        assert any(row["id"] == plid for row in rows)
        assert all("token" not in row for row in rows)

        # Revoke
        r = requests.delete(f"{API}/listings/{lid}/preview-links/{plid}", headers=_h(tok))
        assert r.status_code == 200

        # Public read now 410
        r = requests.get(f"{API}/preview/listings/{token}")
        assert r.status_code == 410
    finally:
        requests.delete(f"{API}/listings/{lid}", headers=_h(tok))


def test_buyer_cannot_create_preview_link_for_others_listing():
    tok = _login(SELLER)
    lid = _create_listing(tok)
    try:
        btok = _login(BUYER)
        r = requests.post(
            f"{API}/listings/{lid}/preview-links",
            json={"expires_hours": 24},
            headers=_h(btok),
        )
        assert r.status_code == 403
    finally:
        requests.delete(f"{API}/listings/{lid}", headers=_h(tok))


def test_invalid_token_404():
    r = requests.get(f"{API}/preview/listings/this-token-does-not-exist")
    assert r.status_code == 404


def test_expires_hours_capped_at_30_days():
    tok = _login(SELLER)
    lid = _create_listing(tok)
    try:
        r = requests.post(
            f"{API}/listings/{lid}/preview-links",
            json={"expires_hours": 9999},  # Way over 720 (30d)
            headers=_h(tok),
        )
        assert r.status_code == 422, r.text  # pydantic validation
    finally:
        requests.delete(f"{API}/listings/{lid}", headers=_h(tok))
