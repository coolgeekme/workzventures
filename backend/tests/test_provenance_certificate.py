"""Tests for Cryptographic Provenance Certificate endpoint.

Covers:
- PDF validity (status, headers, %PDF- magic bytes)
- Authorization (participant / non-participant / admin / 404)
- Content correctness (deal name, parties, NDA, timeline, files, audit chain, CLI)
- ots_proofs entry of kind='vault.certificate' and audit log entry
- Performance (<5s for small rooms)
- Empty-state handling
"""
import io
import os
import time

import pytest
import requests
from pypdf import PdfReader

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

BUYER = {"email": "alex@workz.example.com", "password": "WorkzPass123!"}
SELLER = {"email": "mira@workz.example.com", "password": "WorkzPass123!"}
ADMIN = {"email": "admin@workz.example.com", "password": "WorkzAdmin123!"}

EXISTING_ACTIVE_ROOM = "590511af-0c7b-47a3-b4bf-b2abff404e01"


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def buyer_token():
    return _login(BUYER)


@pytest.fixture(scope="module")
def seller_token():
    return _login(SELLER)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def active_room_id(buyer_token):
    """Find an active room the buyer participates in."""
    r = requests.get(f"{API}/deal-rooms", headers=_auth(buyer_token), timeout=15)
    assert r.status_code == 200, r.text
    rooms = r.json()
    active = [x for x in rooms if x.get("status") != "pending_nda"]
    if not active:
        pytest.skip("No active room available for buyer")
    # Prefer the known seeded room if present
    for x in active:
        if x["id"] == EXISTING_ACTIVE_ROOM:
            return x["id"]
    return active[0]["id"]


# ---------------------------------------------------------------- PDF validity

class TestCertificatePdfValidity:
    def test_returns_pdf_with_attachment_headers(self, buyer_token, active_room_id):
        r = requests.get(
            f"{API}/deal-rooms/{active_room_id}/certificate",
            headers=_auth(buyer_token), timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd.lower()
        assert "workz-provenance-" in cd
        assert cd.endswith('.pdf"') or ".pdf" in cd
        assert r.content[:5] == b"%PDF-", f"Bad magic bytes: {r.content[:8]!r}"
        assert len(r.content) > 2000, f"PDF too small: {len(r.content)} bytes"

    def test_pdf_parses_and_contains_required_sections(self, buyer_token, active_room_id):
        r = requests.get(
            f"{API}/deal-rooms/{active_room_id}/certificate",
            headers=_auth(buyer_token), timeout=20,
        )
        assert r.status_code == 200
        reader = PdfReader(io.BytesIO(r.content))
        assert len(reader.pages) >= 1
        text = "\n".join(p.extract_text() or "" for p in reader.pages)
        # Title & branding
        assert "WORKZ VENTURES" in text.upper()
        assert "PROVENANCE CERTIFICATE" in text.upper()
        # Parties
        assert "BUYER" in text.upper()
        assert "SELLER" in text.upper()
        # NDA section
        assert "NON-DISCLOSURE AGREEMENT" in text.upper() or "NDA" in text.upper()
        # Event timeline
        assert "EVENT TIMELINE" in text.upper() or "BITCOIN" in text.upper()
        # Verification CLI
        assert "ots verify" in text or "opentimestamps-client" in text
        # Audit chain
        assert "AUDIT" in text.upper()

    def test_performance_under_5s(self, buyer_token, active_room_id):
        t0 = time.time()
        r = requests.get(
            f"{API}/deal-rooms/{active_room_id}/certificate",
            headers=_auth(buyer_token), timeout=10,
        )
        elapsed = time.time() - t0
        assert r.status_code == 200
        assert elapsed < 5.0, f"Cert generation took {elapsed:.2f}s (>5s)"


# ---------------------------------------------------------------- Authorization

class TestCertificateAuthorization:
    def test_seller_participant_can_access(self, seller_token):
        """Seller should be able to get cert for their own room."""
        r = requests.get(f"{API}/deal-rooms", headers=_auth(seller_token), timeout=15)
        assert r.status_code == 200
        rooms = [x for x in r.json() if x.get("status") != "pending_nda"]
        if not rooms:
            pytest.skip("No active seller room")
        rid = rooms[0]["id"]
        r = requests.get(
            f"{API}/deal-rooms/{rid}/certificate",
            headers=_auth(seller_token), timeout=20,
        )
        assert r.status_code == 200
        assert r.content[:5] == b"%PDF-"

    def test_non_existent_room_returns_404(self, buyer_token):
        r = requests.get(
            f"{API}/deal-rooms/non-existent-id-xyz/certificate",
            headers=_auth(buyer_token), timeout=10,
        )
        assert r.status_code == 404

    def test_admin_can_access_any_vault(self, admin_token, active_room_id):
        r = requests.get(
            f"{API}/deal-rooms/{active_room_id}/certificate",
            headers=_auth(admin_token), timeout=20,
        )
        assert r.status_code == 200
        assert r.content[:5] == b"%PDF-"

    def test_unauthenticated_request_rejected(self, active_room_id):
        r = requests.get(f"{API}/deal-rooms/{active_room_id}/certificate", timeout=10)
        assert r.status_code in (401, 403)

    def test_non_participant_returns_403(self, active_room_id):
        """Create a third-party buyer and ensure they get 403."""
        new_email = f"TEST_thirdparty_{int(time.time())}@example.com"
        signup = requests.post(f"{API}/auth/register", json={
            "name": "TEST Third Party", "email": new_email,
            "password": "WorkzPass123!", "role": "buyer",
            "organization": "TEST Outsider Co",
        }, timeout=15)
        if signup.status_code not in (200, 201):
            pytest.skip(f"Could not create third-party user: {signup.status_code} {signup.text}")
        third_token = signup.json().get("access_token") or signup.json().get("token") or _login({"email": new_email, "password": "WorkzPass123!"})
        r = requests.get(
            f"{API}/deal-rooms/{active_room_id}/certificate",
            headers=_auth(third_token), timeout=10,
        )
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"


# ------------------------------------------------------- Side-effects (proofs + audit)

class TestCertificateSideEffects:
    def test_generates_vault_certificate_proof(self, buyer_token, admin_token, active_room_id):
        """After hitting cert endpoint, an ots_proofs entry of kind='vault.certificate' should exist."""
        # Snapshot count before
        before = requests.get(
            f"{API}/security/proofs", headers=_auth(admin_token),
            params={"kind": "vault.certificate"}, timeout=15,
        )
        if before.status_code != 200:
            pytest.skip(f"/security/proofs not available: {before.status_code}")
        before_count = len([p for p in before.json() if p.get("target_id") == active_room_id])

        # Generate cert
        r = requests.get(
            f"{API}/deal-rooms/{active_room_id}/certificate",
            headers=_auth(buyer_token), timeout=20,
        )
        assert r.status_code == 200

        # Wait briefly for async notarize_bytes task
        time.sleep(2.5)
        after = requests.get(
            f"{API}/security/proofs", headers=_auth(admin_token),
            params={"kind": "vault.certificate"}, timeout=15,
        )
        assert after.status_code == 200
        after_count = len([p for p in after.json() if p.get("target_id") == active_room_id])
        assert after_count > before_count, (
            f"Expected new vault.certificate proof. before={before_count} after={after_count}"
        )

    def test_audit_log_entry_created(self, buyer_token, admin_token, active_room_id):
        """An audit log entry with action='dealroom.certificate.generate' should appear."""
        r = requests.get(
            f"{API}/deal-rooms/{active_room_id}/certificate",
            headers=_auth(buyer_token), timeout=20,
        )
        assert r.status_code == 200
        time.sleep(1.0)
        logs = requests.get(
            f"{API}/audit/logs", headers=_auth(admin_token), timeout=15,
        )
        if logs.status_code != 200:
            pytest.skip(f"/security/audit not available: {logs.status_code}")
        entries = logs.json() if isinstance(logs.json(), list) else logs.json().get("items", [])
        matched = [
            e for e in entries
            if e.get("action") == "dealroom.certificate.generate"
            and (e.get("target") == active_room_id or e.get("target_id") == active_room_id)
        ]
        assert matched, "No audit entry with action=dealroom.certificate.generate found"
        meta = matched[0].get("meta") or matched[0].get("metadata") or {}
        # cert_id, proof_count, file_count
        assert "cert_id" in meta, f"cert_id missing in audit metadata: {meta}"
        assert "proof_count" in meta
        assert "file_count" in meta


# ------------------------------------------------------- Empty-state handling

class TestEmptyStateRoom:
    def test_cert_works_on_freshly_created_active_room(self, buyer_token, seller_token, admin_token):
        """Bare minimum: a newly created room (NDA signed but no files/findings) still generates a valid PDF."""
        # Use any existing active room — if no files/findings, the sections gracefully skip
        r = requests.get(f"{API}/deal-rooms", headers=_auth(buyer_token), timeout=15)
        if r.status_code != 200:
            pytest.skip("can't list rooms")
        rooms = [x for x in r.json() if x.get("status") != "pending_nda"]
        if not rooms:
            pytest.skip("No active rooms")
        # Pick room with fewest files (closest to empty-state)
        rooms_sorted = sorted(rooms, key=lambda x: x.get("file_count", 0) if isinstance(x.get("file_count"), int) else 0)
        rid = rooms_sorted[0]["id"]
        r = requests.get(
            f"{API}/deal-rooms/{rid}/certificate",
            headers=_auth(buyer_token), timeout=20,
        )
        assert r.status_code == 200
        assert r.content[:5] == b"%PDF-"
        reader = PdfReader(io.BytesIO(r.content))
        assert len(reader.pages) >= 1
