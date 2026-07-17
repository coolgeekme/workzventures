"""Iter-44 — merge behaviour for valuation autofill re-runs.

Verifies that `_merge_autofill_inputs` never "loses" data a prior run had
populated when a subsequent Claude call returns null for that field.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path


def _load_merge_fn():
    """Import server module and pull out `_merge_autofill_inputs`.

    server.py has heavy import-time side effects, so we defer until the test
    is actually running. The helper itself is a pure function.
    """
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    server = importlib.import_module("server")
    return server._merge_autofill_inputs


def test_merge_preserves_old_when_new_is_null():
    merge = _load_merge_fn()
    existing = {
        "dcf": {
            "year1_revenue_usd": 80_000_000,
            "revenue_growth_pct": 30,
            "ebitda_margin_pct": 12,
            "wacc_pct": 12,
        }
    }
    incoming = {
        "dcf": {
            "year1_revenue_usd": None,  # regression from Claude
            "revenue_growth_pct": 25,   # updated
            "ebitda_margin_pct": None,  # regression
            "wacc_pct": 14,             # updated
        }
    }
    out = merge(existing, incoming)
    d = out["dcf"]
    assert d["year1_revenue_usd"] == 80_000_000, "old value must survive"
    assert d["revenue_growth_pct"] == 25, "new non-null wins"
    assert d["ebitda_margin_pct"] == 12, "old value survives new null"
    assert d["wacc_pct"] == 14, "new non-null wins"


def test_merge_unions_list_fields():
    merge = _load_merge_fn()
    existing = {"market_multiples": {"comparable_tickers": ["HLIO", "ISRG"]}}
    incoming = {"market_multiples": {"comparable_tickers": ["ATHX", "HLIO", "NUVA"]}}
    out = merge(existing, incoming)
    tickers = out["market_multiples"]["comparable_tickers"]
    # New comes first, dedupe preserves order
    assert tickers == ["ATHX", "HLIO", "NUVA", "ISRG"]


def test_merge_keeps_untouched_methods():
    merge = _load_merge_fn()
    existing = {
        "recent_transaction": {"post_money_usd": 50_000_000, "time_decay_factor": 1.0},
        "dcf": {"year1_revenue_usd": 10_000_000},
    }
    incoming = {
        # Only dcf came back from the new run
        "dcf": {"year1_revenue_usd": 12_000_000},
    }
    out = merge(existing, incoming)
    assert out["recent_transaction"]["post_money_usd"] == 50_000_000
    assert out["dcf"]["year1_revenue_usd"] == 12_000_000


def test_merge_handles_empty_incoming():
    merge = _load_merge_fn()
    existing = {"dcf": {"year1_revenue_usd": 5_000_000, "wacc_pct": 12}}
    out = merge(existing, {})
    assert out["dcf"]["year1_revenue_usd"] == 5_000_000
    assert out["dcf"]["wacc_pct"] == 12


def test_merge_handles_empty_existing():
    merge = _load_merge_fn()
    incoming = {"dcf": {"year1_revenue_usd": 5_000_000}}
    out = merge({}, incoming)
    assert out["dcf"]["year1_revenue_usd"] == 5_000_000


def test_merge_empty_string_treated_as_null():
    merge = _load_merge_fn()
    existing = {"recent_transaction": {"round_type": "Series B"}}
    incoming = {"recent_transaction": {"round_type": ""}}
    out = merge(existing, incoming)
    assert out["recent_transaction"]["round_type"] == "Series B"
