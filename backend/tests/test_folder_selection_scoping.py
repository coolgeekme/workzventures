"""Regression test for the Box (and any provider) folder-selection scoping bug.

Bug report: after connecting Box via Composio and picking a specific folder,
every folder/document from the account still showed up in the listing no
matter which folder was selected.

Root cause: PATCH /external-sources/{sid}/folders only ever ADDED newly
matched files on top of whatever was already mirrored. If the seller had
run a sync before narrowing their folder selection — e.g. clicking
"Sync now" right after OAuth completes, which defaults to the provider
root — every file from that earlier, broader sync stayed in the Vault
forever. Picking a narrower folder afterward never removed the
out-of-scope files, so the listing kept "showing everything" regardless
of the folder chosen.

Fix: folder selection is authoritative — updating it wipes every
previously mirrored file for that source before the fresh sync runs, so
the Vault only ever reflects the currently selected folder(s).
"""
import os
import sys
import secrets
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


async def _seed_box_source_with_root_sync(db):
    """Simulate: seller connected Box, then hit 'Sync now' before ever
    picking folders (folder_ids=[] -> defaults to provider root), which
    mirrored files from all over the account into the listing."""
    lid = f"test-listing-{secrets.token_hex(4)}"
    sid = f"test-src-{secrets.token_hex(4)}"
    uid = f"test-user-{secrets.token_hex(4)}"
    now = datetime.now(timezone.utc).isoformat()
    await db.listings.insert_one({
        "id": lid, "company_name": "TestCo (folder scoping)",
        "seller_id": uid, "status": "draft", "created_at": now,
    })
    await db.listing_external_sources.insert_one({
        "id": sid, "listing_id": lid, "source_kind": "box",
        "label": "Box test",
        "composio_connected_id": "ca_fake_for_test",
        "entity_id": uid,
        "status": "active", "syncing": False, "file_count": 2,
        "folder_id": None, "folder_ids": [], "folder_labels": [],
        "include_subfolders": True,
        "created_at": now,
    })
    # Files mirrored from the earlier root-wide sync, before any folder
    # was ever selected.
    for i, fname in enumerate(["root-file-1.pdf", "root-file-2.pdf"]):
        await db.listing_staged_files.insert_one({
            "id": f"staged-{sid}-{i}", "listing_id": lid,
            "filename": fname, "size": 10,
            "source": {"kind": "box", "sid": sid, "external_id": f"root-ext-{i}"},
            "created_at": now,
        })
    return {"lid": lid, "sid": sid, "uid": uid}


async def _cleanup(db, fixture):
    await db.listings.delete_one({"id": fixture["lid"]})
    await db.listing_external_sources.delete_one({"id": fixture["sid"]})
    await db.listing_staged_files.delete_many({"listing_id": fixture["lid"]})


class TestFolderSelectionWipesOutOfScopeFiles:
    @pytest.mark.asyncio
    async def test_picking_a_folder_removes_previously_mirrored_root_files(self):
        import server
        fixture = await _seed_box_source_with_root_sync(server.db)
        try:
            user = {"id": fixture["uid"], "role": "seller"}
            body = server.ExternalSourceFoldersUpdate(
                folder_ids=["100"], folder_labels=["Marketing"], include_subfolders=True,
            )

            # Sync itself is irrelevant to this test — stub it out so we
            # only assert on the wipe behavior triggered by the PATCH.
            with patch.object(server, "_run_external_source_sync", AsyncMock(return_value=None)):
                result = await server.update_external_source_folders(
                    fixture["lid"], fixture["sid"], body, user=user,
                )

            assert result["folder_ids"] == ["100"]

            # The old root-wide files must be gone (soft-deleted) — a fresh
            # sync scoped to folder "100" is responsible for repopulating.
            remaining = await server.db.listing_staged_files.find(
                {"listing_id": fixture["lid"], "deleted_at": {"$exists": False}}, {"_id": 0},
            ).to_list(50)
            assert remaining == [], f"expected old out-of-scope files wiped, found: {remaining}"

            src = await server.db.listing_external_sources.find_one(
                {"id": fixture["sid"]}, {"_id": 0},
            )
            assert src["file_count"] == 0
        finally:
            await _cleanup(server.db, fixture)
