"""Folder-picker backend tests:
  - GET  /api/listings/{lid}/external-sources/{sid}/browse
  - PATCH /api/listings/{lid}/external-sources/{sid}/folders
  - Sync iterates multi-folder selections, respects include_subfolders flag

Composio is mocked end-to-end — these tests don't hit the network. They lock
in the picker contract so the frontend can rely on the shape.
"""

import base64
import os
import sys
import secrets
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _wrap(entries, successful=True, err=None):
    return {"successful": successful, "error": err, "data": {"entries": entries}}


def _drive_wrap(files, successful=True):
    return {"successful": successful, "error": None, "data": {"files": files}}


def _dropbox_wrap(entries, successful=True):
    return {"successful": successful, "error": None, "data": {"entries": entries, "cursor": "", "has_more": False}}


async def _seed_source(db, kind, folder_ids=None, include_subfolders=True):
    lid = f"test-listing-{secrets.token_hex(4)}"
    sid = f"test-src-{secrets.token_hex(4)}"
    uid = f"test-user-{secrets.token_hex(4)}"
    now = datetime.now(timezone.utc).isoformat()
    await db.listings.insert_one({
        "id": lid, "company_name": f"TestCo ({kind} picker)",
        "seller_id": uid, "status": "draft", "created_at": now,
    })
    await db.listing_external_sources.insert_one({
        "id": sid, "listing_id": lid, "source_kind": kind,
        "label": f"{kind} test",
        "composio_connected_id": "ca_fake_for_test",
        "entity_id": uid,
        "status": "active", "syncing": True, "file_count": 0,
        "folder_id": None,
        "folder_ids": folder_ids or [],
        "include_subfolders": include_subfolders,
        "created_at": now,
    })
    return {"lid": lid, "sid": sid, "uid": uid, "kind": kind}


async def _cleanup(db, fixture):
    await db.listings.delete_one({"id": fixture["lid"]})
    await db.listing_external_sources.delete_one({"id": fixture["sid"]})
    await db.listing_staged_files.delete_many({"listing_id": fixture["lid"]})


class TestBrowseFolderHelper:
    @pytest.mark.asyncio
    async def test_box_browse_returns_only_folders(self):
        """Box `BOX_LIST_ITEMS_IN_FOLDER` returns folders + files + web_links;
        browse should expose only the folders."""
        import server
        fixture = await _seed_source(server.db, "box")
        try:
            mixed = [
                {"type": "folder", "id": "100", "name": "Marketing"},
                {"type": "file", "id": "999", "name": "ignore.pdf"},
                {"type": "folder", "id": "200", "name": "Financials"},
                {"type": "web_link", "id": "wl1", "name": "old-link"},
            ]
            async def fake_action(slug, conn_id, args, user_id=None):
                assert slug == "BOX_LIST_ITEMS_IN_FOLDER"
                return _wrap(mixed)

            with patch.object(server, "_composio_action_execute", AsyncMock(side_effect=fake_action)):
                src = await server.db.listing_external_sources.find_one(
                    {"id": fixture["sid"]}, {"_id": 0}
                )
                result = await server._browse_folder(src, None)

            assert result["can_browse"] is True
            assert result["err"] is None
            assert result["parent_id"] == "0"
            names = [f["name"] for f in result["folders"]]
            assert "Marketing" in names and "Financials" in names
            assert "ignore.pdf" not in names
            assert "old-link" not in names
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_drive_browse_uses_folder_query(self):
        """Drive's `q` must filter by mimeType=folder under the parent."""
        import server
        fixture = await _seed_source(server.db, "googledrive")
        try:
            captured = {}
            async def fake_action(slug, conn_id, args, user_id=None):
                captured["slug"] = slug
                captured["args"] = args
                return _drive_wrap([
                    {"id": "f1", "name": "Pitch decks"},
                    {"id": "f2", "name": "Term sheets"},
                ])

            with patch.object(server, "_composio_action_execute", AsyncMock(side_effect=fake_action)):
                src = await server.db.listing_external_sources.find_one(
                    {"id": fixture["sid"]}, {"_id": 0}
                )
                result = await server._browse_folder(src, "1AbC")

            assert captured["slug"] == "GOOGLEDRIVE_LIST_FILES"
            assert "in parents" in captured["args"]["q"]
            assert "vnd.google-apps.folder" in captured["args"]["q"]
            assert [f["name"] for f in result["folders"]] == ["Pitch decks", "Term sheets"]
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_dropbox_browse_filters_by_tag_folder(self):
        import server
        fixture = await _seed_source(server.db, "dropbox")
        try:
            async def fake_action(slug, conn_id, args, user_id=None):
                assert slug == "DROPBOX_LIST_FILES_IN_FOLDER"
                # Confirm we asked for non-recursive listing in the picker.
                assert args.get("recursive") is False
                return _dropbox_wrap([
                    {".tag": "folder", "name": "Reports", "path_lower": "/reports", "path_display": "/Reports"},
                    {".tag": "file", "name": "ignore.pdf", "path_lower": "/ignore.pdf"},
                    {".tag": "folder", "name": "Pitch", "path_lower": "/pitch", "path_display": "/Pitch"},
                ])

            with patch.object(server, "_composio_action_execute", AsyncMock(side_effect=fake_action)):
                src = await server.db.listing_external_sources.find_one(
                    {"id": fixture["sid"]}, {"_id": 0}
                )
                result = await server._browse_folder(src, "")
            assert {f["name"] for f in result["folders"]} == {"Reports", "Pitch"}
            # IDs should be the dropbox path (lower) — what we pass back for sync.
            assert any(f["id"] == "/reports" for f in result["folders"])
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_onedrive_browse_uses_graph_proxy(self):
        import server
        fixture = await _seed_source(server.db, "onedrive")
        try:
            captured = {}
            async def fake_proxy(kind, conn_id, endpoint, query=None, user_id=None):
                captured["endpoint"] = endpoint
                return {"value": [
                    {"id": "1A", "name": "Sales", "folder": {"childCount": 3}},
                    {"id": "1B", "name": "deck.pptx", "file": {"mimeType": "application/vnd.ms-powerpoint"}},
                    {"id": "1C", "name": "Finance", "folder": {"childCount": 0}},
                ]}

            with patch.object(server, "_composio_proxy_get_json", AsyncMock(side_effect=fake_proxy)):
                src = await server.db.listing_external_sources.find_one(
                    {"id": fixture["sid"]}, {"_id": 0}
                )
                # No parent → should hit /me/drive/root/children
                result = await server._browse_folder(src, None)
            assert captured["endpoint"] == "/me/drive/root/children"
            assert {f["name"] for f in result["folders"]} == {"Sales", "Finance"}
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_sharepoint_browse_degrades_gracefully(self):
        import server
        fixture = await _seed_source(server.db, "sharepoint")
        try:
            src = await server.db.listing_external_sources.find_one(
                {"id": fixture["sid"]}, {"_id": 0}
            )
            result = await server._browse_folder(src, None)
            assert result["can_browse"] is False
            assert result["folders"] == []
            assert "paste" in (result["err"] or "").lower() or "manually" in (result["err"] or "").lower()
        finally:
            await _cleanup(server.db, fixture)


class TestMultiFolderSync:
    @pytest.mark.asyncio
    async def test_multi_folder_box_pulls_from_each_selection(self):
        """Seller picks 2 Box folders. Sync should iterate both and stage
        files from each (no duplication, no missing folder)."""
        import server
        fixture = await _seed_source(server.db, "box", folder_ids=["100", "200"], include_subfolders=False)
        try:
            responses = {
                ("BOX_LIST_ITEMS_IN_FOLDER", "100"): _wrap([
                    {"type": "file", "id": "1001", "name": "f100-1.pdf"},
                    {"type": "file", "id": "1002", "name": "f100-2.pdf"},
                ]),
                ("BOX_LIST_ITEMS_IN_FOLDER", "200"): _wrap([
                    {"type": "file", "id": "2001", "name": "f200-1.pdf"},
                ]),
            }
            async def fake_action(slug, conn_id, args, user_id=None):
                if slug == "BOX_LIST_ITEMS_IN_FOLDER":
                    return responses.get((slug, args.get("folder_id")), _wrap([]))
                if slug == "BOX_DOWNLOAD_FILE":
                    return {"successful": True, "error": None, "data": {"content_base64": base64.b64encode(b"x").decode()}}
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
                await server._run_external_source_sync(fixture["lid"], fixture["sid"], fixture["uid"])

            staged = await server.db.listing_staged_files.find(
                {"listing_id": fixture["lid"]}, {"_id": 0}
            ).to_list(50)
            assert sorted(f["filename"] for f in staged) == ["f100-1.pdf", "f100-2.pdf", "f200-1.pdf"]
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_include_subfolders_false_skips_recursion(self):
        """When seller toggles off 'Include subfolders', sync must NOT descend
        into subfolders even if they exist."""
        import server
        fixture = await _seed_source(server.db, "box", folder_ids=["100"], include_subfolders=False)
        try:
            captured = []
            responses = {
                ("BOX_LIST_ITEMS_IN_FOLDER", "100"): _wrap([
                    {"type": "file", "id": "1001", "name": "directly-in-100.pdf"},
                    {"type": "folder", "id": "150", "name": "Nested"},
                ]),
                ("BOX_LIST_ITEMS_IN_FOLDER", "150"): _wrap([
                    {"type": "file", "id": "1501", "name": "should-not-appear.pdf"},
                ]),
            }
            async def fake_action(slug, conn_id, args, user_id=None):
                captured.append((slug, args.get("folder_id")))
                if slug == "BOX_LIST_ITEMS_IN_FOLDER":
                    return responses.get((slug, args.get("folder_id")), _wrap([]))
                if slug == "BOX_DOWNLOAD_FILE":
                    return {"successful": True, "error": None,
                            "data": {"content_base64": base64.b64encode(b"x").decode()}}
                return {"successful": False}

            async def fake_mirror(lid, sid, kind, name, blob, mime, ext_id, uid):
                await server.db.listing_staged_files.insert_one({
                    "id": f"f-{ext_id}", "listing_id": lid, "filename": name,
                    "size": len(blob), "source": {"kind": kind, "sid": sid, "external_id": ext_id},
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                return f"f-{ext_id}"

            with patch.object(server, "_composio_action_execute", AsyncMock(side_effect=fake_action)), \
                 patch.object(server, "_composio_proxy_download", AsyncMock(return_value=None)), \
                 patch.object(server, "_mirror_one_file", AsyncMock(side_effect=fake_mirror)):
                await server._run_external_source_sync(fixture["lid"], fixture["sid"], fixture["uid"])

            staged = await server.db.listing_staged_files.find(
                {"listing_id": fixture["lid"]}, {"_id": 0}
            ).to_list(50)
            names = [f["filename"] for f in staged]
            assert names == ["directly-in-100.pdf"], f"expected only direct file, got {names}"
            # Folder 150 must NEVER have been listed when include_subfolders=False.
            listed_folder_ids = [fid for slug, fid in captured if slug == "BOX_LIST_ITEMS_IN_FOLDER"]
            assert "150" not in listed_folder_ids
        finally:
            await _cleanup(server.db, fixture)

    @pytest.mark.asyncio
    async def test_dropbox_uses_native_recursive_flag(self):
        """Dropbox supports `recursive=true` natively — we should pass it
        through (no app-layer BFS for Dropbox)."""
        import server
        fixture = await _seed_source(server.db, "dropbox", folder_ids=["/Marketing"], include_subfolders=True)
        try:
            captured = {}
            async def fake_action(slug, conn_id, args, user_id=None):
                if slug == "DROPBOX_LIST_FILES_IN_FOLDER":
                    captured["recursive"] = args.get("recursive")
                    captured["path"] = args.get("path")
                    return _dropbox_wrap([
                        {".tag": "file", "name": "deck.pdf", "id": "id:abc1", "path_lower": "/marketing/deck.pdf", "path_display": "/Marketing/deck.pdf"},
                        {".tag": "folder", "name": "Pitch", "id": "id:def2", "path_lower": "/marketing/pitch"},
                        {".tag": "file", "name": "p1.pdf", "id": "id:abc2", "path_lower": "/marketing/pitch/p1.pdf", "path_display": "/Marketing/Pitch/p1.pdf"},
                    ])
                if slug == "DROPBOX_READ_FILE":
                    return {"successful": True, "error": None,
                            "data": {"content_base64": base64.b64encode(b"x").decode()}}
                return {"successful": False}

            async def fake_mirror(lid, sid, kind, name, blob, mime, ext_id, uid):
                await server.db.listing_staged_files.insert_one({
                    "id": f"f-{ext_id}", "listing_id": lid, "filename": name,
                    "size": len(blob), "source": {"kind": kind, "sid": sid, "external_id": ext_id},
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                return f"f-{ext_id}"

            with patch.object(server, "_composio_action_execute", AsyncMock(side_effect=fake_action)), \
                 patch.object(server, "_composio_proxy_download", AsyncMock(return_value=None)), \
                 patch.object(server, "_mirror_one_file", AsyncMock(side_effect=fake_mirror)):
                await server._run_external_source_sync(fixture["lid"], fixture["sid"], fixture["uid"])

            assert captured["recursive"] is True
            assert captured["path"] == "/Marketing"
            names = [f["filename"] for f in await server.db.listing_staged_files.find(
                {"listing_id": fixture["lid"]}, {"_id": 0}
            ).to_list(50)]
            assert sorted(names) == ["deck.pdf", "p1.pdf"]
        finally:
            await _cleanup(server.db, fixture)
