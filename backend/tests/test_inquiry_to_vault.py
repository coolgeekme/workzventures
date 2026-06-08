"""
Regression tests for the inquiry → Vault lifecycle and the new clearer
status labels.

A Vault opens ONLY when:
  1. Seller marks the inquiry as `engaged` (UI label: "Accepted")
  2. Seller explicitly opens the Vault → status `pending_nda`
  3. Buyer accepts the NDA → status `active`

If the seller marks `passed` (UI label: "Declined"), NO Vault opens.
"""
import os
import uuid

import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://buyer-intel-lab.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

SELLER = {"email": "mira@workz.example.com", "password": "WorkzPass123!"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _register_buyer():
    email = f"buyer-{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": "DemoPass123!", "name": "Test Buyer",
              "role": "buyer", "organization": "Cascade Test"},
        timeout=20,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["token"], email


def _seller_listing():
    stok = _login(SELLER)
    listings = requests.get(
        f"{API}/listings",
        headers={"Authorization": f"Bearer {stok}"},
        timeout=15,
    ).json()
    return stok, listings[0]


def _create_inquiry(buyer_token, listing_id, message="DD interest"):
    r = requests.post(
        f"{API}/marketplace/{listing_id}/inquire",
        headers={"Authorization": f"Bearer {buyer_token}"},
        json={"message": message},
        timeout=20,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_passed_status_does_not_open_a_vault():
    stok, listing = _seller_listing()
    btok, _ = _register_buyer()
    inq = _create_inquiry(btok, listing["id"], "Want to evaluate")

    # Seller marks as passed (= declined)
    r = requests.patch(
        f"{API}/inquiries/{inq['id']}/status",
        headers={"Authorization": f"Bearer {stok}"},
        json={"status": "passed"},
        timeout=15,
    )
    assert r.status_code == 200, r.text

    # Buyer must see status "passed" and NO deal_room_id
    fresh = requests.get(
        f"{API}/inquiries",
        headers={"Authorization": f"Bearer {btok}"},
        timeout=15,
    ).json()
    my = [i for i in fresh if i["id"] == inq["id"]][0]
    assert my["status"] == "passed"
    assert not my.get("deal_room_id")

    # Buyer's rooms list should NOT contain a room for this listing
    rooms = requests.get(
        f"{API}/deal-rooms",
        headers={"Authorization": f"Bearer {btok}"},
        timeout=15,
    ).json()
    listing_rooms = [r for r in rooms if r["listing_id"] == listing["id"]]
    assert not listing_rooms, "passed inquiry must NOT produce a Vault"

    # Attempt to force-open should fail because inquiry is not engaged
    bad = requests.post(
        f"{API}/inquiries/{inq['id']}/open-room",
        headers={"Authorization": f"Bearer {stok}"},
        timeout=15,
    )
    assert bad.status_code == 400
    assert "engaged" in bad.text.lower()


def test_engaged_then_open_room_grants_buyer_vault_access():
    stok, listing = _seller_listing()
    btok, _ = _register_buyer()
    inq = _create_inquiry(btok, listing["id"], "Serious interest")

    # Seller: engaged (= accepted)
    requests.patch(
        f"{API}/inquiries/{inq['id']}/status",
        headers={"Authorization": f"Bearer {stok}"},
        json={"status": "engaged"},
        timeout=15,
    )

    # Seller opens the Vault
    r = requests.post(
        f"{API}/inquiries/{inq['id']}/open-room",
        headers={"Authorization": f"Bearer {stok}"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    assert r.json()["status"] == "pending_nda"

    # Buyer can now see the room
    rooms = requests.get(
        f"{API}/deal-rooms",
        headers={"Authorization": f"Bearer {btok}"},
        timeout=15,
    ).json()
    assert any(rm["id"] == rid for rm in rooms), "buyer must see the new Vault"

    # Buyer cannot ask Co-pilot before NDA
    cp = requests.post(
        f"{API}/deal-rooms/{rid}/copilot",
        headers={"Authorization": f"Bearer {btok}"},
        json={"message": "hi"},
        timeout=20,
    )
    assert cp.status_code == 400
    assert "nda" in cp.text.lower()

    # Buyer signs NDA → Vault unlocks
    nda = requests.post(
        f"{API}/deal-rooms/{rid}/accept-nda",
        headers={"Authorization": f"Bearer {btok}"},
        json={"signed_name": "Test Buyer"},
        timeout=15,
    )
    assert nda.status_code == 200, nda.text
    detail = requests.get(
        f"{API}/deal-rooms/{rid}",
        headers={"Authorization": f"Bearer {btok}"},
        timeout=15,
    )
    assert detail.status_code == 200
    assert detail.json()["status"] == "active"
