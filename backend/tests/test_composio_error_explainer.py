"""Iter-46 — Friendly Composio download error explainer."""
from __future__ import annotations

import importlib
import sys
from pathlib import Path


def _load_explainer():
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    server = importlib.import_module("server")
    return server._explain_composio_download_error


def test_box_403_insufficient_permissions_gives_actionable_guidance():
    fn = _load_explainer()
    # Real error string surfaced by the user in production:
    raw = ('{"type":"error","status":403,"code":"access_denied_insufficient_permissions",'
           '"help_url":"http://developers.box.com/docs/#errors","message":"Access denied - "}')
    out = fn(source_kind="box", action_error=raw)
    assert "Previewer" in out and "Viewer" in out
    assert "Re-authorize" in out or "re-authorize" in out
    assert "Composio" in out


def test_googledrive_403_gives_shared_drive_hint():
    fn = _load_explainer()
    out = fn(source_kind="googledrive", action_error='403 The user has not granted the app permission')
    assert "Shared Drive" in out or "shared" in out.lower()


def test_onedrive_accessdenied_hints_sensitivity_label():
    fn = _load_explainer()
    out = fn(source_kind="onedrive", action_error='403 accessDenied on file')
    assert "Sensitivity" in out or "IRM" in out


def test_dropbox_403_hints_team_plan():
    fn = _load_explainer()
    out = fn(source_kind="dropbox", action_error='403 insufficient permissions')
    assert "Team" in out or "admin" in out.lower()


def test_payload_too_large_returns_generic_size_hint():
    fn = _load_explainer()
    out = fn(source_kind="box", action_error='The tool response payload is too large (exceeds 10MB)')
    assert "too large" in out.lower() or "Compress" in out


def test_unknown_error_falls_back_to_raw_string():
    fn = _load_explainer()
    out = fn(source_kind="box", action_error='connection reset by peer')
    assert "download failed" in out
    assert "connection reset" in out


def test_missing_action_error_returns_generic_message():
    fn = _load_explainer()
    out = fn(source_kind="box", action_error=None)
    assert "download failed" in out
