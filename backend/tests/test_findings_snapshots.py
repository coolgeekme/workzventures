"""Findings snapshots + PDF export + email share (iter-34).

Tests the new endpoints:
  - GET  /api/deal-rooms/{rid}/findings-snapshots
  - GET  /api/deal-rooms/{rid}/findings-snapshots/{job_id}
  - GET  /api/deal-rooms/{rid}/findings-snapshots/{job_id}/pdf
  - POST /api/deal-rooms/{rid}/findings-snapshots/{job_id}/email

Plus the job_id stamping on findings, the latest-only filter on
GET /deal-rooms/{rid}, and the diff helper.
"""

import os
import sys
import secrets
import uuid as _u
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


async def _seed_room(db, file_count=2):
    rid = f"test-room-{secrets.token_hex(4)}"
    buyer_id = f"test-buyer-{secrets.token_hex(4)}"
    seller_id = f"test-seller-{secrets.token_hex(4)}"
    now = datetime.now(timezone.utc).isoformat()
    await db.users.insert_many([
        {"id": buyer_id, "email": f"b-{buyer_id}@x.test", "name": "B", "role": "buyer",
         "status": "active", "created_at": now},
        {"id": seller_id, "email": f"s-{seller_id}@x.test", "name": "S", "role": "seller",
         "status": "active", "created_at": now},
    ])
    await db.deal_rooms.insert_one({
        "id": rid, "buyer_id": buyer_id, "seller_id": seller_id,
        "buyer_name": "B", "seller_name": "S", "buyer_org": "BCo", "seller_org": "SCo",
        "listing_name": "TestCo Snapshots", "status": "active", "created_at": now,
    })
    for i in range(file_count):
        await db.deal_room_files.insert_one({
            "id": f"f-{i}-{secrets.token_hex(2)}", "room_id": rid,
            "filename": f"doc{i}.pdf", "folder": "financials",
            "page_count": 1,
            "pages": [{"page": 1, "text": f"Snapshot page {i} text. EBITDA 22%."}],
            "content": f"Snapshot text {i}",
            "uploaded_at": now,
        })
    return {"rid": rid, "buyer_id": buyer_id, "seller_id": seller_id}


async def _cleanup(db, fx):
    await db.deal_rooms.delete_one({"id": fx["rid"]})
    await db.deal_room_files.delete_many({"room_id": fx["rid"]})
    await db.deal_room_findings.delete_many({"room_id": fx["rid"]})
    await db.findings_jobs.delete_many({"room_id": fx["rid"]})
    await db.users.delete_many({"id": {"$in": [fx["buyer_id"], fx["seller_id"]]}})


async def _seed_snapshot(db, rid, *, finished_offset_min=0, findings_titles=None,
                        executive_summary="Material concentration risk in top-3 customers.",
                        severity="medium"):
    """Insert a completed findings_job + a parallel batch of findings
    stamped with that job_id. `finished_offset_min` lets a test build
    multiple snapshots ordered in time without sleeping."""
    job_id = str(_u.uuid4())
    base = datetime.now(timezone.utc) - timedelta(minutes=60)
    finished_at = (base + timedelta(minutes=finished_offset_min)).isoformat()
    created_at = (base + timedelta(minutes=finished_offset_min - 1)).isoformat()
    findings_titles = findings_titles or ["Customer concentration"]
    breakdown = {"high": 0, "medium": 0, "low": 0}
    breakdown[severity] = breakdown.get(severity, 0) + len(findings_titles)
    await db.findings_jobs.insert_one({
        "id": job_id, "room_id": rid, "status": "completed",
        "requested_by": "test", "question": None,
        "files_to_analyze": 2, "files_analyzed": 2, "total_files_in_room": 2,
        "findings_count": len(findings_titles), "truncated": False,
        "executive_summary": executive_summary,
        "severity_breakdown": breakdown,
        "created_at": created_at, "started_at": created_at,
        "finished_at": finished_at, "duration_ms": 5000, "error": None,
    })
    finding_docs = []
    for i, title in enumerate(findings_titles):
        finding_docs.append({
            "id": str(_u.uuid4()), "room_id": rid, "job_id": job_id,
            "severity": severity, "workstream": "finance",
            "title": title,
            "description": f"Auto-seeded description for {title}.",
            "citation": {"file_id": None, "filename": "doc0.pdf",
                         "page": 1, "excerpt": f"verbatim excerpt for {title}"},
            "created_at": finished_at,
        })
    if finding_docs:
        await db.deal_room_findings.insert_many(finding_docs)
    return job_id


class TestSnapshotsList:
    @pytest.mark.asyncio
    async def test_list_returns_latest_first_with_fresh_count(self):
        import server
        fx = await _seed_room(server.db, file_count=3)
        try:
            await _seed_snapshot(server.db, fx["rid"], finished_offset_min=0)
            j2 = await _seed_snapshot(server.db, fx["rid"], finished_offset_min=20)

            # Add a NEW file after the latest job's finished_at — should
            # count as "fresh" in the response.
            now = datetime.now(timezone.utc).isoformat()
            await server.db.deal_room_files.insert_one({
                "id": f"f-fresh-{secrets.token_hex(2)}", "room_id": fx["rid"],
                "filename": "freshly_added.pdf", "folder": "other",
                "uploaded_at": now,
            })

            fake_user = {"id": fx["buyer_id"], "name": "B", "role": "buyer"}
            result = await server.list_findings_snapshots(fx["rid"], user=fake_user)

            assert len(result["snapshots"]) == 2
            assert result["snapshots"][0]["id"] == j2, "latest snapshot must come first"
            # The freshly-added file plus the seeded files all post-date the
            # snapshot's `finished_at` in this test (we back-dated the
            # snapshot 40 min). Just assert the freshly-added one is in.
            assert result["fresh_files_since_last_run"] >= 1
        finally:
            await _cleanup(server.db, fx)

    @pytest.mark.asyncio
    async def test_list_no_snapshots_returns_empty(self):
        import server
        fx = await _seed_room(server.db)
        try:
            fake_user = {"id": fx["buyer_id"], "name": "B", "role": "buyer"}
            result = await server.list_findings_snapshots(fx["rid"], user=fake_user)
            assert result["snapshots"] == []
            assert result["fresh_files_since_last_run"] == 0
        finally:
            await _cleanup(server.db, fx)


class TestSnapshotDetail:
    @pytest.mark.asyncio
    async def test_snapshot_detail_includes_diff_vs_prior(self):
        """Build two snapshots; the second adds a new finding and resolves
        one. Verify the diff counts come out right."""
        import server
        fx = await _seed_room(server.db)
        try:
            await _seed_snapshot(
                server.db, fx["rid"], finished_offset_min=0,
                findings_titles=["Customer concentration", "Auditor changed mid-year"],
            )
            j2 = await _seed_snapshot(
                server.db, fx["rid"], finished_offset_min=20,
                findings_titles=["Customer concentration", "Off-balance-sheet lease"],
            )
            fake_user = {"id": fx["buyer_id"], "name": "B", "role": "buyer"}
            result = await server.get_findings_snapshot(fx["rid"], j2, user=fake_user)

            assert result["job"]["id"] == j2
            assert len(result["findings"]) == 2
            diff = result["diff"]
            assert diff is not None
            assert diff["new"] == 1  # Off-balance-sheet
            assert diff["resolved"] == 1  # Auditor changed
            assert diff["unchanged"] == 1  # Customer concentration
        finally:
            await _cleanup(server.db, fx)

    @pytest.mark.asyncio
    async def test_first_snapshot_has_no_diff(self):
        import server
        fx = await _seed_room(server.db)
        try:
            j1 = await _seed_snapshot(server.db, fx["rid"], finished_offset_min=0)
            fake_user = {"id": fx["buyer_id"], "name": "B", "role": "buyer"}
            result = await server.get_findings_snapshot(fx["rid"], j1, user=fake_user)
            assert result["diff"] is None
        finally:
            await _cleanup(server.db, fx)


class TestPdfExport:
    @pytest.mark.asyncio
    async def test_pdf_export_returns_valid_pdf_with_filename(self):
        import server
        fx = await _seed_room(server.db)
        try:
            j1 = await _seed_snapshot(
                server.db, fx["rid"], finished_offset_min=0,
                findings_titles=["High customer concentration", "Off-balance-sheet lease"],
                severity="high",
            )
            fake_user = {"id": fx["buyer_id"], "name": "B", "role": "buyer"}
            resp = await server.export_findings_pdf(fx["rid"], j1, user=fake_user)

            assert resp.media_type == "application/pdf"
            assert resp.body[:5] == b"%PDF-", "response body must be a real PDF"
            # Audit logged.
            audit = await server.db.audit_logs.find_one(
                {"action": "vault.findings.pdf_export", "target": fx["rid"]},
                {"_id": 0},
            )
            assert audit is not None
            assert audit["meta"]["job_id"] == j1
            # Filename header includes vault slug + date.
            cd = resp.headers.get("content-disposition", "")
            assert "Findings_TestCo_Snapshots_" in cd
            assert ".pdf" in cd
        finally:
            await _cleanup(server.db, fx)

    @pytest.mark.asyncio
    async def test_pdf_404_for_unknown_or_incomplete_snapshot(self):
        import server
        from fastapi import HTTPException
        fx = await _seed_room(server.db)
        try:
            fake_user = {"id": fx["buyer_id"], "name": "B", "role": "buyer"}
            with pytest.raises(HTTPException) as e:
                await server.export_findings_pdf(fx["rid"], "no-such-job", user=fake_user)
            assert e.value.status_code == 404
        finally:
            await _cleanup(server.db, fx)


class TestEmailShare:
    @pytest.mark.asyncio
    async def test_email_send_invokes_resend_per_recipient(self):
        import server
        fx = await _seed_room(server.db)
        try:
            j1 = await _seed_snapshot(server.db, fx["rid"], finished_offset_min=0)
            sends = []
            async def fake_send(**kw):
                sends.append(kw["to"])
                return {"ok": True, "id": f"resend-{kw['to']}"}

            with patch.object(server, "send_email_with_attachment",
                              AsyncMock(side_effect=fake_send)):
                from server import FindingsEmailRequest
                result = await server.email_findings_pdf(
                    fx["rid"], j1,
                    FindingsEmailRequest(
                        recipients=["partner@fund.example", "analyst@fund.example"],
                        note="Please review before Friday's IC.",
                    ),
                    user={"id": fx["buyer_id"], "name": "B", "role": "buyer"},
                )

            assert result["sent"] == 2
            assert result["failures"] == []
            assert sorted(sends) == ["analyst@fund.example", "partner@fund.example"]

            audit = await server.db.audit_logs.find_one(
                {"action": "vault.findings.email", "target": fx["rid"]},
                {"_id": 0},
            )
            assert audit is not None
            assert audit["meta"]["sent"] == 2
            assert sorted(audit["meta"]["recipients"]) == ["analyst@fund.example", "partner@fund.example"]
        finally:
            await _cleanup(server.db, fx)

    @pytest.mark.asyncio
    async def test_email_rejects_empty_recipients(self):
        import server
        from fastapi import HTTPException
        fx = await _seed_room(server.db)
        try:
            j1 = await _seed_snapshot(server.db, fx["rid"])
            from server import FindingsEmailRequest
            with pytest.raises(HTTPException) as e:
                await server.email_findings_pdf(
                    fx["rid"], j1,
                    FindingsEmailRequest(recipients=[]),
                    user={"id": fx["buyer_id"], "name": "B", "role": "buyer"},
                )
            assert e.value.status_code == 400
        finally:
            await _cleanup(server.db, fx)


class TestDiffHelper:
    def test_diff_matches_on_workstream_and_title(self):
        import server
        prior = [
            {"workstream": "finance", "title": "Customer concentration"},
            {"workstream": "legal", "title": "Pending litigation"},
        ]
        current = [
            {"workstream": "finance", "title": "Customer concentration"},  # unchanged
            {"workstream": "finance", "title": "Off-balance lease"},        # new
        ]
        d = server._diff_findings(current, prior)
        assert len(d["unchanged"]) == 1
        assert len(d["new"]) == 1
        assert len(d["resolved"]) == 1  # Pending litigation dropped
        assert d["new"][0]["title"] == "Off-balance lease"
        assert d["resolved"][0]["title"] == "Pending litigation"

    def test_diff_normalizes_title_case(self):
        import server
        prior = [{"workstream": "Finance", "title": "Customer Concentration"}]
        current = [{"workstream": "finance", "title": "customer concentration"}]
        d = server._diff_findings(current, prior)
        # Same finding, just renamed case-wise — must NOT be counted as new.
        assert len(d["new"]) == 0
        assert len(d["unchanged"]) == 1
