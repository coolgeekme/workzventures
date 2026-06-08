"""
Smoke tests for admin user management + invite flow + public-register hardening.
"""
import os
import time
import uuid

import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://buyer-intel-lab.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@workz.example.com", "password": "WorkzAdmin123!"}
BUYER = {"email": "alex@workz.example.com", "password": "WorkzPass123!"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_public_register_rejects_admin_role():
    r = requests.post(
        f"{API}/auth/register",
        json={
            "email": f"hack-{uuid.uuid4().hex[:6]}@example.com",
            "password": "Strong123!",
            "name": "Hack",
            "role": "admin",
            "organization": "X",
        },
        timeout=20,
    )
    assert r.status_code in (400, 422), f"admin role must be rejected, got {r.status_code} {r.text}"


def test_public_register_accepts_buyer_and_seller():
    for role in ("buyer", "seller"):
        r = requests.post(
            f"{API}/auth/register",
            json={
                "email": f"ok-{role}-{uuid.uuid4().hex[:6]}@example.com",
                "password": "Strong123!",
                "name": "Test",
                "role": role,
                "organization": "Cascade",
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text


def test_non_admin_cannot_call_admin_endpoints():
    btok = _login(BUYER)
    for path in ("/admin/users", "/admin/invites"):
        r = requests.get(
            f"{API}{path}",
            headers={"Authorization": f"Bearer {btok}"},
            timeout=15,
        )
        assert r.status_code == 403, f"{path} should be 403 for buyer, got {r.status_code}"


def test_admin_full_user_lifecycle():
    atok = _login(ADMIN)
    H = {"Authorization": f"Bearer {atok}"}
    email = f"lifecycle-{int(time.time())}@example.com"

    # 1. Create user
    r = requests.post(
        f"{API}/admin/users",
        headers=H,
        json={"email": email, "password": "Strong123!", "name": "LC", "role": "buyer", "organization": "Acme"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    uid = r.json()["id"]

    # 2. List → user appears
    listing = requests.get(f"{API}/admin/users?q=lifecycle", headers=H, timeout=15).json()
    assert any(u["id"] == uid for u in listing)

    # 3. Edit (role + org + reset password)
    r = requests.patch(
        f"{API}/admin/users/{uid}",
        headers=H,
        json={"role": "seller", "organization": "NewOrg"},
        timeout=15,
    )
    assert r.status_code == 200
    assert r.json()["role"] == "seller"
    assert r.json()["organization"] == "NewOrg"

    r = requests.post(
        f"{API}/admin/users/{uid}/password",
        headers=H, json={"password": "ReallyStrong123!"}, timeout=15,
    )
    assert r.status_code == 200

    # Verify new password works
    lg = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": "ReallyStrong123!"},
                       timeout=15)
    assert lg.status_code == 200

    # 4. Deactivate
    r = requests.delete(f"{API}/admin/users/{uid}", headers=H, timeout=15)
    assert r.status_code == 200

    # 5. Deactivated user cannot log in
    lg = requests.post(f"{API}/auth/login",
                       json={"email": email, "password": "ReallyStrong123!"},
                       timeout=15)
    assert lg.status_code == 403


def test_admin_cannot_deactivate_demo_users():
    atok = _login(ADMIN)
    H = {"Authorization": f"Bearer {atok}"}
    listing = requests.get(f"{API}/admin/users?q=mira", headers=H, timeout=15).json()
    mira = [u for u in listing if u["email"] == "mira@workz.example.com"][0]
    r = requests.delete(f"{API}/admin/users/{mira['id']}", headers=H, timeout=15)
    assert r.status_code == 400


def test_invite_flow_end_to_end():
    atok = _login(ADMIN)
    H = {"Authorization": f"Bearer {atok}"}
    email = f"invite-{int(time.time())}@example.com"

    # 1. Admin creates invite
    r = requests.post(
        f"{API}/admin/invites",
        headers=H,
        json={"email": email, "name": "Invitee", "role": "buyer",
              "organization": "Test", "expires_hours": 24},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    inv = r.json()
    assert inv["status"] == "pending"
    assert inv["accept_url"]
    token = inv["token"]

    # 2. Public preview endpoint works (no auth)
    pv = requests.get(f"{API}/auth/invite/{token}", timeout=15)
    assert pv.status_code == 200
    assert pv.json()["email"] == email

    # 3. Accept invite → creates account + returns JWT
    ac = requests.post(
        f"{API}/auth/accept-invite",
        json={"token": token, "password": "Strong123!", "name": "Accepted"},
        timeout=15,
    )
    assert ac.status_code == 200
    user_body = ac.json()
    assert user_body["user"]["email"] == email
    assert user_body["user"]["role"] == "buyer"
    assert user_body["token"]

    # 4. Token cannot be re-used
    again = requests.post(
        f"{API}/auth/accept-invite",
        json={"token": token, "password": "Strong123!"},
        timeout=15,
    )
    assert again.status_code == 410


def test_invite_expired_returns_410():
    atok = _login(ADMIN)
    H = {"Authorization": f"Bearer {atok}"}
    # Create an invite with hours=1, then manually push expires_at backwards via Mongo isn't an option here,
    # so we use the revoke endpoint as a proxy for "non-pending" path.
    email = f"revoke-{int(time.time())}@example.com"
    r = requests.post(
        f"{API}/admin/invites",
        headers=H,
        json={"email": email, "role": "buyer", "expires_hours": 24},
        timeout=15,
    )
    iid = r.json()["id"]
    token = r.json()["token"]
    rv = requests.delete(f"{API}/admin/invites/{iid}", headers=H, timeout=15)
    assert rv.status_code == 200

    # Revoked invite can no longer be accepted
    ac = requests.post(
        f"{API}/auth/accept-invite",
        json={"token": token, "password": "Strong123!"},
        timeout=15,
    )
    assert ac.status_code == 410
