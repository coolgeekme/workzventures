"""
Smoke tests for the buyer-only Private Locker.
Run: cd /app/backend && pytest tests/test_private_locker.py -q
"""
import io
import os
import uuid

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
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.text}"
    return r.json()["token"]


def _upload(token, filename, listing_id=None, folder="memos", note=None, body=b"hello"):
    files = {"file": (filename, io.BytesIO(body), "text/plain")}
    data = {"folder": folder}
    if listing_id:
        data["listing_id"] = listing_id
    if note:
        data["note"] = note
    r = requests.post(
        f"{API}/private-locker/files",
        headers={"Authorization": f"Bearer {token}"},
        files=files,
        data=data,
        timeout=30,
    )
    return r


def test_buyer_can_upload_and_list_workspace_file():
    token = _login(BUYER)
    r = _upload(token, f"ws-{uuid.uuid4()}.txt", note="workspace test")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["scope"] == "workspace"
    assert doc["listing_id"] is None
    assert doc["encrypted"] is True
    fid = doc["id"]

    listing = requests.get(
        f"{API}/private-locker/files",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert listing.status_code == 200
    ids = {f["id"] for f in listing.json()}
    assert fid in ids

    # cleanup
    requests.delete(
        f"{API}/private-locker/files/{fid}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )


def test_buyer_can_upload_listing_scoped_and_download_roundtrip():
    token = _login(BUYER)
    # Pick any active listing
    mp = requests.get(
        f"{API}/marketplace",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    ).json()
    assert mp, "no marketplace listings"
    lid = mp[0]["id"]

    payload = "Internal DD scoring 8.5/10 — proceed to LOI".encode("utf-8")
    r = _upload(token, "scoring.txt", listing_id=lid, folder="memos",
                note="scoring sheet", body=payload)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["scope"] == "listing"
    assert doc["listing_id"] == lid
    fid = doc["id"]

    # Scope filter should return it
    by_scope = requests.get(
        f"{API}/private-locker/files",
        params={"listing_id": lid},
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    ).json()
    assert any(f["id"] == fid for f in by_scope)
    assert by_scope[0]["listing_name"]  # decorated

    # Download — must decrypt and return the same bytes
    dl = requests.get(
        f"{API}/private-locker/files/{fid}/download",
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    assert dl.status_code == 200
    assert dl.content == payload

    # cleanup
    requests.delete(
        f"{API}/private-locker/files/{fid}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )


def test_seller_is_blocked_from_locker():
    stoken = _login(SELLER)
    r = requests.get(
        f"{API}/private-locker/files",
        headers={"Authorization": f"Bearer {stoken}"},
        timeout=15,
    )
    assert r.status_code == 403
    # Upload also blocked
    r2 = _upload(stoken, "should-fail.txt")
    assert r2.status_code == 403


def test_other_buyer_cannot_see_another_buyers_files():
    """Even within the buyer role, files are scoped to user_id."""
    buyer_token = _login(BUYER)
    r = _upload(buyer_token, f"private-{uuid.uuid4()}.txt")
    assert r.status_code == 200
    fid = r.json()["id"]

    # Forge a request as if from another buyer — we don't have a second buyer
    # account seeded, so register a throwaway buyer.
    throwaway_email = f"buyer-{uuid.uuid4().hex[:8]}@workz.test"
    reg = requests.post(
        f"{API}/auth/register",
        json={
            "email": throwaway_email,
            "password": "DemoPass123!",
            "name": "Throwaway Buyer",
            "role": "buyer",
            "organization": "test",
        },
        timeout=20,
    )
    if reg.status_code in (200, 201):
        other_token = reg.json()["token"]
        listing = requests.get(
            f"{API}/private-locker/files",
            headers={"Authorization": f"Bearer {other_token}"},
            timeout=15,
        )
        assert listing.status_code == 200
        ids = {f["id"] for f in listing.json()}
        assert fid not in ids, "buyer can see another buyer's locker file!"

        # Download attempt must 404
        dl = requests.get(
            f"{API}/private-locker/files/{fid}/download",
            headers={"Authorization": f"Bearer {other_token}"},
            timeout=15,
        )
        assert dl.status_code == 404

    requests.delete(
        f"{API}/private-locker/files/{fid}",
        headers={"Authorization": f"Bearer {buyer_token}"},
        timeout=15,
    )


def test_delete_is_idempotent_and_removes_file():
    token = _login(BUYER)
    r = _upload(token, f"del-{uuid.uuid4()}.txt")
    assert r.status_code == 200
    fid = r.json()["id"]

    d1 = requests.delete(
        f"{API}/private-locker/files/{fid}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert d1.status_code == 200

    # Second delete → 404
    d2 = requests.delete(
        f"{API}/private-locker/files/{fid}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert d2.status_code == 404
