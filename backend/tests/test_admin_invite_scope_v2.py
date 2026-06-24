"""Additional regression coverage for admin-invite scope bug fix.

Extends test_admin_invite_role_scope.py with:
  - Admin invite endpoint response-shape regression (token, accept_url, email,
    role, status='pending').
  - Seeded user scope regression (mira/alex/admin/agent are all 'principal').
"""

import os
import secrets
import requests
import pytest


def _api():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    v = line.split("=", 1)[1].strip()
                    break
    return v.rstrip("/") + "/api"


API = _api()
ADMIN = ("admin@workz.example.com", "WorkzAdmin123!")


def _login(email, password):
    r = requests.post(f"{API}/auth/login",
                      json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_tok():
    return _login(*ADMIN)


class TestAdminInviteResponseShape:
    """POST /api/admin/invites must return {token, accept_url, email, role, status='pending'}."""

    def test_admin_invite_response_fields(self, admin_tok):
        suffix = secrets.token_hex(4)
        email = f"invitee.shape.{suffix}@workz.example.com"
        r = requests.post(
            f"{API}/admin/invites",
            json={"email": email, "name": "Shape Tester", "role": "agent",
                  "organization": None, "expires_hours": 1},
            headers={"Authorization": f"Bearer {admin_tok}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()

        # Required fields
        for key in ("token", "accept_url", "email", "role", "status"):
            assert key in body, f"missing field '{key}' in invite response: {body}"

        assert body["email"] == email
        assert body["role"] == "agent"
        assert body["status"] == "pending", f"expected status='pending', got {body['status']}"
        assert isinstance(body["token"], str) and len(body["token"]) > 0
        assert isinstance(body["accept_url"], str) and body["token"] in body["accept_url"], \
            f"accept_url should embed token: accept_url={body['accept_url']} token={body['token']}"


class TestSeededUserScope:
    """Existing seeded users must keep account_scope='principal'."""

    @pytest.mark.parametrize("email,password,role", [
        ("mira@workz.example.com",  "WorkzPass123!",  "seller"),
        ("alex@workz.example.com",  "WorkzPass123!",  "buyer"),
        ("admin@workz.example.com", "WorkzAdmin123!", "admin"),
        ("agent@workz.example.com", "WorkzPass123!", "agent"),
    ])
    def test_seeded_user_is_principal(self, email, password, role):
        tok = _login(email, password)
        me = requests.get(f"{API}/auth/me",
                          headers={"Authorization": f"Bearer {tok}"},
                          timeout=30)
        assert me.status_code == 200, me.text
        body = me.json()
        assert body["role"] == role, f"{email}: expected role={role}, got {body['role']}"
        assert body["account_scope"] == "principal", \
            f"{email}: expected scope=principal, got {body['account_scope']}"
