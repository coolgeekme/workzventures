"""Vault Co-pilot must access every file in the data room — including ones
mirrored from Composio external sources (Box / Drive / OneDrive / SharePoint
/ Dropbox). Symptom before the fix: with the file inventory capped at 30, a
buyer asking about a file that the Composio sync added LATER (i.e. not in
the oldest-30) got "No documents…" or a wrong citation. Cap is now 200
(matching Findings), per-page markers are emitted, and citations carry
page numbers.

Claude is mocked end-to-end — we only validate the inventory contract +
citation parsing.
"""

import os
import sys
import secrets
import re
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


async def _seed_vault_with_files(db, *, file_count, composio_files=None):
    """Build a room with mixed manual + Composio-mirrored files. `composio_files`
    is a list of indexes (0-based) of files to mark as source.kind=box."""
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
        "listing_name": "TestCo", "status": "active", "created_at": now,
    })
    composio_set = set(composio_files or [])
    for i in range(file_count):
        is_composio = i in composio_set
        await db.deal_room_files.insert_one({
            "id": f"f-{i}-{secrets.token_hex(2)}",
            "room_id": rid,
            "filename": f"file_{i:03d}{'_composio' if is_composio else ''}.pdf",
            "folder": "other",
            "content_type": "application/pdf",
            "size_bytes": 1024,
            "page_count": 3,
            "pages": [
                {"page": 1, "text": f"Header page for file {i}. Key fact: revenue Y{i} = $1,234,567."},
                {"page": 2, "text": f"Body of file {i}. Customer concentration: {i*5}% top-3."},
                {"page": 3, "text": f"Tail of file {i}. Signed by Party {i}."},
            ],
            "content": f"flat text for file {i}",
            "source": {"kind": "box", "sid": "sid-1", "external_id": f"box-{i}"} if is_composio else None,
            "uploaded_at": now,
        })
    return {"rid": rid, "buyer_id": buyer_id, "seller_id": seller_id}


async def _cleanup(db, fixture):
    await db.deal_rooms.delete_one({"id": fixture["rid"]})
    await db.deal_room_files.delete_many({"room_id": fixture["rid"]})
    await db.deal_room_messages.delete_many({"room_id": fixture["rid"]})
    await db.users.delete_many({"id": {"$in": [fixture["buyer_id"], fixture["seller_id"]]}})


class TestCopilotAccessAllFiles:
    @pytest.mark.asyncio
    async def test_copilot_inventory_includes_composio_mirrored_files(self):
        """A buyer asking about a Composio-mirrored file gets a citation
        that points at the actual file id — proves the file made it into
        the Claude prompt and the citation parser matched it."""
        import server
        # Seed: 5 manual + 3 Composio = 8 total. Composio files are at
        # positions 5, 6, 7 (oldest are 0-4). Old cap of 30 doesn't matter
        # for 8 files, but the fix path is still exercised.
        fixture = await _seed_vault_with_files(server.db, file_count=8, composio_files=[5, 6, 7])
        try:
            captured_prompt = {}
            async def fake_claude(sys_prompt, user_prompt, session_id=None):
                captured_prompt["sys"] = sys_prompt
                captured_prompt["user"] = user_prompt
                # Cite a Composio-mirrored file by name + page so the
                # citation parser has a real target to match.
                return "Per [file_005_composio.pdf p.2], top-3 customers represent 25% of revenue."

            fake_user = {"id": fixture["buyer_id"], "name": "B", "role": "buyer"}

            with patch.object(server, "call_claude", AsyncMock(side_effect=fake_claude)), \
                 patch.object(server, "_clone_listing_files_into_room", AsyncMock(return_value=0)):
                from server import CopilotAsk
                result = await server.ask_copilot(
                    fixture["rid"],
                    CopilotAsk(message="What is the customer concentration?"),
                    user=fake_user,
                )

            # The Composio file MUST appear in the prompt inventory.
            assert "file_005_composio.pdf" in captured_prompt["user"]
            assert "source=box" in captured_prompt["user"], \
                "Composio source kind should be visible in the inventory line"
            assert "<page n=" in captured_prompt["user"], \
                "Inventory must use per-page markers (matches Findings)"

            # Citation came back parsed with page number.
            citations = result["assistant_message"]["citations"]
            assert len(citations) == 1
            assert citations[0]["filename"] == "file_005_composio.pdf"
            assert citations[0]["page"] == 2
            assert citations[0]["file_id"]  # bound to a real file row
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_copilot_handles_120_files_no_truncation_warning(self):
        """120 files fit under the 200 cap — every file is in the inventory,
        no truncation note. Verifies the cap lift from 30."""
        import server
        # Mark the LAST 5 as composio so they'd have dropped out under the
        # old 30-file cap. With the new cap they're in.
        composio_idxs = list(range(115, 120))
        fixture = await _seed_vault_with_files(server.db, file_count=120, composio_files=composio_idxs)
        try:
            captured = {}
            async def fake_claude(sys_prompt, user_prompt, session_id=None):
                captured["user"] = user_prompt
                return "Answer."

            fake_user = {"id": fixture["buyer_id"], "name": "B", "role": "buyer"}

            with patch.object(server, "call_claude", AsyncMock(side_effect=fake_claude)), \
                 patch.object(server, "_clone_listing_files_into_room", AsyncMock(return_value=0)):
                from server import CopilotAsk
                await server.ask_copilot(
                    fixture["rid"],
                    CopilotAsk(message="Summarize."),
                    user=fake_user,
                )
            # All 120 filenames present.
            for i in [0, 50, 100, 115, 119]:
                expected = f"file_{i:03d}"
                assert expected in captured["user"], \
                    f"file index {i} missing from inventory — cap lift broken"
            # No truncation note at 120 ≤ 200.
            assert "only the 200 oldest" not in captured["user"]
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_copilot_surfaces_truncation_when_over_200_files(self):
        """When the vault has 220 files, the inventory shows 200 and the
        prompt explicitly tells the model so it can warn the buyer."""
        import server
        fixture = await _seed_vault_with_files(server.db, file_count=220)
        try:
            captured = {}
            async def fake_claude(sys_prompt, user_prompt, session_id=None):
                captured["user"] = user_prompt
                return "Answer."

            fake_user = {"id": fixture["buyer_id"], "name": "B", "role": "buyer"}

            with patch.object(server, "call_claude", AsyncMock(side_effect=fake_claude)), \
                 patch.object(server, "_clone_listing_files_into_room", AsyncMock(return_value=0)):
                from server import CopilotAsk
                await server.ask_copilot(
                    fixture["rid"],
                    CopilotAsk(message="Anything."),
                    user=fake_user,
                )
            assert "only the 200 oldest" in captured["user"]
            assert "220 files" in captured["user"]
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_copilot_legacy_filename_only_citation_still_works(self):
        """Backward-compat: if the model emits [filename] without a page
        number, citation defaults to page 1."""
        import server
        fixture = await _seed_vault_with_files(server.db, file_count=3)
        try:
            async def fake_claude(sys_prompt, user_prompt, session_id=None):
                return "Per [file_001.pdf], revenue grew 22% YoY."

            fake_user = {"id": fixture["buyer_id"], "name": "B", "role": "buyer"}

            with patch.object(server, "call_claude", AsyncMock(side_effect=fake_claude)), \
                 patch.object(server, "_clone_listing_files_into_room", AsyncMock(return_value=0)):
                from server import CopilotAsk
                result = await server.ask_copilot(
                    fixture["rid"],
                    CopilotAsk(message="Q?"),
                    user=fake_user,
                )
            citations = result["assistant_message"]["citations"]
            assert len(citations) == 1
            assert citations[0]["filename"] == "file_001.pdf"
            assert citations[0]["page"] == 1
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_copilot_triggers_clone_backfill_for_composio_files(self):
        """When the buyer asks a question, the copilot MUST run a
        clone-backfill before reading files — that's the path Composio-
        mirrored files take into the deal room. Regression: previously
        only fired for status in (pending_nda, active, preview)."""
        import server
        fixture = await _seed_vault_with_files(server.db, file_count=1)
        # Force a status the old guard would have skipped.
        await server.db.deal_rooms.update_one(
            {"id": fixture["rid"]}, {"$set": {"status": "closing", "listing_id": "L-test"}},
        )
        try:
            backfill_called = []
            async def fake_backfill(listing_id, room_id, user_id, only_missing=False):
                backfill_called.append((listing_id, room_id, only_missing))
                return 0

            async def fake_claude(sys_prompt, user_prompt, session_id=None):
                return "Answer."

            fake_user = {"id": fixture["buyer_id"], "name": "B", "role": "buyer"}

            with patch.object(server, "call_claude", AsyncMock(side_effect=fake_claude)), \
                 patch.object(server, "_clone_listing_files_into_room", AsyncMock(side_effect=fake_backfill)):
                from server import CopilotAsk
                await server.ask_copilot(
                    fixture["rid"],
                    CopilotAsk(message="Q?"),
                    user=fake_user,
                )
            assert backfill_called, "backfill must run on every copilot call so Composio-synced files surface"
            assert backfill_called[0][0] == "L-test"
            assert backfill_called[0][2] is True  # only_missing=True
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_dynamic_budget_for_large_vault_still_includes_every_file(self):
        """Even with a 200-file vault, every file must appear in the
        inventory (just with a tighter per-file slice). Verifies the
        dynamic char-budget logic."""
        import server
        fixture = await _seed_vault_with_files(server.db, file_count=200)
        try:
            captured = {}
            async def fake_claude(sys_prompt, user_prompt, session_id=None):
                captured["user"] = user_prompt
                return "Answer."

            fake_user = {"id": fixture["buyer_id"], "name": "B", "role": "buyer"}

            with patch.object(server, "call_claude", AsyncMock(side_effect=fake_claude)), \
                 patch.object(server, "_clone_listing_files_into_room", AsyncMock(return_value=0)):
                from server import CopilotAsk
                await server.ask_copilot(
                    fixture["rid"],
                    CopilotAsk(message="Anything."),
                    user=fake_user,
                )
            # Spot-check files at boundary positions.
            for i in [0, 99, 199]:
                expected = f"file_{i:03d}"
                assert expected in captured["user"], \
                    f"file {i} not in 200-file inventory"
            # Inventory must stay under the 150K budget (with some slack
            # for wrappers / headers / transcript).
            assert len(captured["user"]) < 250_000, \
                f"prompt too large: {len(captured['user'])} chars — risk of Claude OOM"
        finally:
            await _cleanup(server.db, fixture)
