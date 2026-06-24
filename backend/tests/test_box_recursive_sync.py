"""Box external-source sync — folder recursion regression.

Bug: Seller connected Box, sync succeeded silently with 0 files mirrored
because their Box root contained only subfolders (the common shape on every
Box account). The earlier flat list+filter dropped all folder entries and
produced no diagnostic message.

Fix: recurse into subfolders (depth-limited to 4, total file cap 100) and
emit a clear `last_error` when the entire tree had zero downloadable files.

These tests stub `_composio_action_execute` so we don't need a live Box
connection — we just want to verify the recursion + diagnostic branches.
"""

import base64
import os
import sys
import secrets
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _box_list_response(entries):
    """Match the Composio v3 envelope shape — successful=True with a `data`
    payload containing Box's native {entries: [...]} array."""
    return {
        "successful": True,
        "error": None,
        "data": {"entries": entries, "total_count": len(entries)},
    }


def _box_download_response(content_b64: str):
    return {
        "successful": True,
        "error": None,
        "data": {"content_base64": content_b64},
    }


async def _seed_box_source(db):
    lid = f"test-listing-{secrets.token_hex(4)}"
    sid = f"test-src-{secrets.token_hex(4)}"
    uid = f"test-user-{secrets.token_hex(4)}"
    now = datetime.now(timezone.utc).isoformat()
    await db.listings.insert_one({
        "id": lid, "company_name": "TestCo (box recursion)",
        "seller_id": uid, "status": "draft", "created_at": now,
    })
    await db.listing_external_sources.insert_one({
        "id": sid, "listing_id": lid, "source_kind": "box",
        "label": "Box test",
        "composio_connected_id": "ca_fake_for_test",
        "entity_id": uid,
        "status": "active", "syncing": True, "file_count": 0,
        "folder_id": None,
        "created_at": now,
    })
    return {"lid": lid, "sid": sid, "uid": uid}


async def _cleanup(db, fixture):
    await db.listings.delete_one({"id": fixture["lid"]})
    await db.listing_external_sources.delete_one({"id": fixture["sid"]})
    await db.listing_staged_files.delete_many({"listing_id": fixture["lid"]})


class TestBoxFolderRecursion:
    @pytest.mark.asyncio
    async def test_nested_files_get_pulled(self):
        """Root has 2 folders; folder A has 1 file at depth 1; folder B has
        a subfolder containing 1 file at depth 2. Both files should mirror."""
        import server
        fixture = await _seed_box_source(server.db)
        try:
            responses = {
                ("BOX_LIST_ITEMS_IN_FOLDER", "0"): _box_list_response([
                    {"type": "folder", "id": "100", "name": "FolderA"},
                    {"type": "folder", "id": "200", "name": "FolderB"},
                ]),
                ("BOX_LIST_ITEMS_IN_FOLDER", "100"): _box_list_response([
                    {"type": "file", "id": "1001", "name": "fileA.pdf"},
                ]),
                ("BOX_LIST_ITEMS_IN_FOLDER", "200"): _box_list_response([
                    {"type": "folder", "id": "201", "name": "FolderB.1"},
                ]),
                ("BOX_LIST_ITEMS_IN_FOLDER", "201"): _box_list_response([
                    {"type": "file", "id": "2011", "name": "fileB1.pdf"},
                ]),
            }

            async def fake_action(slug, conn_id, args, user_id=None):
                if slug == "BOX_LIST_ITEMS_IN_FOLDER":
                    key = (slug, args.get("folder_id"))
                    return responses.get(key, _box_list_response([]))
                if slug == "BOX_DOWNLOAD_FILE":
                    payload = base64.b64encode(b"hello world").decode()
                    return _box_download_response(payload)
                raise AssertionError(f"unexpected slug {slug}")

            async def fake_mirror(lid, sid, kind, name, blob, mime, ext_id, uid):
                await server.db.listing_staged_files.insert_one({
                    "id": f"f-{ext_id}", "listing_id": lid,
                    "filename": name, "size": len(blob),
                    "source": {"kind": kind, "sid": sid, "external_id": ext_id},
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                return f"f-{ext_id}"

            with patch.object(server, "_composio_action_execute", AsyncMock(side_effect=fake_action)), \
                 patch.object(server, "_composio_proxy_download", AsyncMock(return_value=None)), \
                 patch.object(server, "_mirror_one_file", AsyncMock(side_effect=fake_mirror)):
                await server._run_external_source_sync(
                    fixture["lid"], fixture["sid"], fixture["uid"],
                )

            staged = await server.db.listing_staged_files.find(
                {"listing_id": fixture["lid"]}, {"_id": 0}
            ).to_list(50)
            names = sorted(f["filename"] for f in staged)
            assert names == ["fileA.pdf", "fileB1.pdf"], f"expected both nested files, got {names}"

            src = await server.db.listing_external_sources.find_one(
                {"id": fixture["sid"]}, {"_id": 0}
            )
            assert src["file_count"] == 2
            assert src["syncing"] is False
            assert not src.get("last_error"), f"unexpected error: {src.get('last_error')}"
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_empty_root_with_only_folders_surfaces_actionable_error(self):
        """User connected Box root that has subfolders only and they are
        themselves empty. The sync should set last_error to a clear,
        seller-actionable string — NOT silently report success with 0 files."""
        import server
        fixture = await _seed_box_source(server.db)
        try:
            responses = {
                ("BOX_LIST_ITEMS_IN_FOLDER", "0"): _box_list_response([
                    {"type": "folder", "id": "100", "name": "EmptyFolderA"},
                ]),
                ("BOX_LIST_ITEMS_IN_FOLDER", "100"): _box_list_response([]),
            }

            async def fake_action(slug, conn_id, args, user_id=None):
                key = (slug, args.get("folder_id"))
                return responses.get(key, _box_list_response([]))

            with patch.object(server, "_composio_action_execute", AsyncMock(side_effect=fake_action)), \
                 patch.object(server, "_composio_proxy_download", AsyncMock(return_value=None)):
                await server._run_external_source_sync(
                    fixture["lid"], fixture["sid"], fixture["uid"],
                )

            src = await server.db.listing_external_sources.find_one(
                {"id": fixture["sid"]}, {"_id": 0}
            )
            assert src["file_count"] == 0
            err = (src.get("last_error") or "").lower()
            assert "no downloadable files" in err, \
                f"expected an actionable diagnostic, got: {src.get('last_error')!r}"
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_default_root_folder_id_is_zero(self):
        """A Box source created without a folder_id must send folder_id='0'
        (Box's root) when calling LIST_ITEMS_IN_FOLDER — regression for the
        previous 'folder_id required' Composio 400."""
        import server
        fixture = await _seed_box_source(server.db)
        try:
            captured = []

            async def fake_action(slug, conn_id, args, user_id=None):
                captured.append((slug, dict(args)))
                return _box_list_response([])

            with patch.object(server, "_composio_action_execute", AsyncMock(side_effect=fake_action)), \
                 patch.object(server, "_composio_proxy_download", AsyncMock(return_value=None)):
                await server._run_external_source_sync(
                    fixture["lid"], fixture["sid"], fixture["uid"],
                )

            assert captured, "list action was never called"
            first_call_args = captured[0][1]
            assert first_call_args.get("folder_id") == "0", \
                f"expected default folder_id='0', got {first_call_args}"
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_recursion_respects_total_cap(self):
        """If the user's Box has more than 100 files across nested folders,
        we stop at the cap rather than spinning indefinitely."""
        import server
        fixture = await _seed_box_source(server.db)
        try:
            # Root contains 1 folder containing 200 files.
            many = [{"type": "file", "id": f"f{i}", "name": f"file{i}.pdf"} for i in range(200)]
            responses = {
                ("BOX_LIST_ITEMS_IN_FOLDER", "0"): _box_list_response([
                    {"type": "folder", "id": "100", "name": "Big"},
                ]),
                ("BOX_LIST_ITEMS_IN_FOLDER", "100"): _box_list_response(many),
            }

            async def fake_action(slug, conn_id, args, user_id=None):
                if slug == "BOX_LIST_ITEMS_IN_FOLDER":
                    return responses.get((slug, args.get("folder_id")), _box_list_response([]))
                if slug == "BOX_DOWNLOAD_FILE":
                    return _box_download_response(base64.b64encode(b"x").decode())
                return {"successful": False}

            async def fake_mirror(lid, sid, kind, name, blob, mime, ext_id, uid):
                await server.db.listing_staged_files.insert_one({
                    "id": f"f-{ext_id}", "listing_id": lid,
                    "filename": name, "size": len(blob),
                    "source": {"kind": kind, "sid": sid, "external_id": ext_id},
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                return f"f-{ext_id}"

            with patch.object(server, "_composio_action_execute", AsyncMock(side_effect=fake_action)), \
                 patch.object(server, "_composio_proxy_download", AsyncMock(return_value=None)), \
                 patch.object(server, "_mirror_one_file", AsyncMock(side_effect=fake_mirror)):
                await server._run_external_source_sync(
                    fixture["lid"], fixture["sid"], fixture["uid"],
                )

            count = await server.db.listing_staged_files.count_documents(
                {"listing_id": fixture["lid"]}
            )
            # Per-batch loop is capped at 100 by the existing `for f in files_meta[:100]`.
            assert count <= 100, f"expected ≤100 files due to per-sync cap, got {count}"
            assert count > 0, "expected at least some files to be pulled"
        finally:
            await _cleanup(server.db, fixture)
