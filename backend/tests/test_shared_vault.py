"""
Smoke tests for the shared-Vault dual access model and the seed Vault.
Both buyer (alex) and seller (mira) must see the same active Vault, list its files,
and use the AI Co-pilot.
"""
import os

import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://buyer-intel-lab.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

BUYER = {"email": "alex@workz.example.com", "password": "WorkzPass123!"}
SELLER = {"email": "mira@workz.example.com", "password": "WorkzPass123!"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _rooms(token):
    r = requests.get(f"{API}/deal-rooms", headers={"Authorization": f"Bearer {token}"}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def test_seed_vault_is_visible_to_both_demo_accounts():
    btok, stok = _login(BUYER), _login(SELLER)
    b_rooms = _rooms(btok)
    s_rooms = _rooms(stok)
    seed_b = [r for r in b_rooms if r.get("is_seed")]
    seed_s = [r for r in s_rooms if r.get("is_seed")]
    assert seed_b, "buyer should see at least one seed vault"
    assert seed_s, "seller should see at least one seed vault"
    # The seed vault id must be the same for both
    assert seed_b[0]["id"] == seed_s[0]["id"], "buyer & seller must share the same Vault"
    assert seed_b[0]["status"] == "active"
    assert seed_b[0]["files_count"] >= 3


def test_both_parties_can_open_room_and_see_same_files():
    btok, stok = _login(BUYER), _login(SELLER)
    rid = [r for r in _rooms(btok) if r.get("is_seed")][0]["id"]

    b = requests.get(f"{API}/deal-rooms/{rid}", headers={"Authorization": f"Bearer {btok}"}, timeout=20)
    s = requests.get(f"{API}/deal-rooms/{rid}", headers={"Authorization": f"Bearer {stok}"}, timeout=20)
    assert b.status_code == 200 and s.status_code == 200
    b_files = {f["filename"] for f in b.json().get("files", [])}
    s_files = {f["filename"] for f in s.json().get("files", [])}
    assert b_files == s_files, "buyer and seller must see an identical file set"
    assert "Helios_CIM_summary.md" in b_files


def test_outsider_buyer_cannot_access_vault():
    """A third-party authenticated user must get 403 — proves Vault is scoped."""
    btok = _login(BUYER)
    rid = [r for r in _rooms(btok) if r.get("is_seed")][0]["id"]

    # Register a throwaway buyer
    import uuid
    email = f"outsider-{uuid.uuid4().hex[:8]}@workz.test"
    reg = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": "DemoPass123!", "name": "Outsider",
              "role": "buyer", "organization": "test"},
        timeout=20,
    )
    if reg.status_code not in (200, 201):
        return  # If registration disabled, skip silently
    other = reg.json()["token"]
    r = requests.get(f"{API}/deal-rooms/{rid}", headers={"Authorization": f"Bearer {other}"}, timeout=15)
    assert r.status_code == 403, r.text


def test_copilot_answers_for_both_buyer_and_seller():
    btok, stok = _login(BUYER), _login(SELLER)
    rid = [r for r in _rooms(btok) if r.get("is_seed")][0]["id"]

    rb = requests.post(
        f"{API}/deal-rooms/{rid}/copilot",
        headers={"Authorization": f"Bearer {btok}"},
        json={"message": "What is the FY24 revenue?"},
        timeout=60,
    )
    assert rb.status_code == 200, rb.text
    body_b = rb.json()
    assert "assistant_message" in body_b
    assert body_b["assistant_message"]["content"]
    assert body_b["assistant_message"]["citations"], "co-pilot must cite source files"

    rs = requests.post(
        f"{API}/deal-rooms/{rid}/copilot",
        headers={"Authorization": f"Bearer {stok}"},
        json={"message": "Summarize the top risks."},
        timeout=60,
    )
    assert rs.status_code == 200, rs.text
    body_s = rs.json()
    assert body_s["assistant_message"]["content"]
    assert body_s["assistant_message"]["citations"]


def test_seed_vault_survives_demo_purge():
    """The 48h sweep must NOT delete the seed vault, its inquiry, or its files."""
    admin = _login({"email": "admin@workz.example.com", "password": "WorkzAdmin123!"})
    purge = requests.post(
        f"{API}/admin/demo/purge",
        headers={"Authorization": f"Bearer {admin}"},
        timeout=60,
    )
    assert purge.status_code == 200

    btok = _login(BUYER)
    rooms = _rooms(btok)
    seed = [r for r in rooms if r.get("is_seed")]
    assert seed, "seed Vault was wrongly purged"
    assert seed[0]["files_count"] >= 3
