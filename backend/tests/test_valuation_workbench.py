"""Unit tests for /app/backend/valuation_workbench.py — Phase A."""

import json
from unittest.mock import AsyncMock

import pytest

from valuation_workbench import (
    compute_recent_transaction,
    compute_market_multiples,
    compute_vc_method,
    compute_dcf,
    compute_option_pricing,
    aggregate_band,
    compute_all_methods,
    autofill_workbench,
    extract_term_sheet,
    DEFAULT_WEIGHTS,
    _norm_cdf,
    _num,
    _fmt,
)


# ------------ pure math ------------
def test_recent_transaction_applies_decay():
    r = compute_recent_transaction({"post_money_usd": 100_000_000, "time_decay_factor": 0.65})
    assert r["adjusted_value_usd"] == 65_000_000
    assert "$100.0M × decay 0.65" in r["notes"]


def test_recent_transaction_defaults_decay_to_1():
    r = compute_recent_transaction({"post_money_usd": 50_000_000})
    assert r["adjusted_value_usd"] == 50_000_000


def test_recent_transaction_missing_returns_none():
    r = compute_recent_transaction({})
    assert r["value_usd"] is None and r["adjusted_value_usd"] is None


def test_market_multiples_with_discount():
    r = compute_market_multiples({
        "estimated_annual_revenue_usd": 10_000_000,
        "median_multiple": 5,
        "size_discount_pct": 20,
    })
    # 10M × 5 = 50M, less 20% = 40M
    assert r["raw_value_usd"] == 50_000_000
    assert r["value_usd"] == 40_000_000


def test_market_multiples_missing_returns_none():
    assert compute_market_multiples({})["value_usd"] is None
    assert compute_market_multiples({"estimated_annual_revenue_usd": 10_000_000})["value_usd"] is None


def test_vc_method_math():
    r = compute_vc_method({
        "projected_exit_revenue_usd": 100_000_000,
        "exit_multiple": 5,
        "years_to_exit": 5,
        "target_irr_pct": 30,
        "current_ownership_pct": 20,
    })
    # terminal = 500M; PV = 500M / 1.3^5 ≈ 134.7M; allocated = 20% ≈ 26.9M
    assert r["terminal_value_usd"] == 500_000_000
    assert 130_000_000 < r["present_value_usd"] < 140_000_000
    assert 25_000_000 < r["value_usd"] < 28_000_000


def test_vc_method_full_ownership_when_pct_missing():
    r = compute_vc_method({
        "projected_exit_revenue_usd": 100_000_000, "exit_multiple": 5,
        "years_to_exit": 5, "target_irr_pct": 30,
    })
    assert r["value_usd"] == r["present_value_usd"]


def test_vc_method_missing_returns_none_with_reason():
    r = compute_vc_method({"projected_exit_revenue_usd": 100_000_000})
    assert r["value_usd"] is None
    assert "Missing inputs" in r["notes"]


def test_dcf_math_reasonable():
    r = compute_dcf({
        "year1_revenue_usd": 10_000_000,
        "revenue_growth_pct": 30,
        "ebitda_margin_pct": 25,
        "capex_pct_revenue": 5,
        "tax_rate_pct": 21,
        "terminal_growth_pct": 3,
        "wacc_pct": 12,
    })
    assert r["value_usd"] > 0
    assert len(r["yearly"]) == 5
    # Enterprise value should be dominated by terminal value for a high-growth firm
    assert r["pv_of_terminal_usd"] > r["pv_of_5yr_cash_flows_usd"]


def test_dcf_rejects_bad_wacc():
    r = compute_dcf({
        "year1_revenue_usd": 10_000_000, "revenue_growth_pct": 30,
        "ebitda_margin_pct": 25, "capex_pct_revenue": 5,
        "tax_rate_pct": 21, "terminal_growth_pct": 5, "wacc_pct": 4,
    })
    assert r["value_usd"] is None
    assert "must exceed terminal growth" in r["notes"]


def test_option_pricing_call_option_math():
    # Sanity: with V >> L and moderate σ, common should capture most of V
    r = compute_option_pricing({
        "enterprise_value_usd": 100_000_000,
        "total_preferred_liquidation_pref_usd": 20_000_000,
        "volatility_pct": 50,
        "time_to_liquidity_years": 3,
        "risk_free_rate_pct": 4,
        "common_share_pct": 100,
    })
    # Common should be ~80-95M for these inputs
    assert 75_000_000 < r["value_usd"] < 100_000_000
    assert r["preferred_class_value_usd"] > 0


def test_option_pricing_missing_inputs():
    r = compute_option_pricing({"enterprise_value_usd": 100_000_000})
    assert r["value_usd"] is None
    assert "Missing inputs" in r["notes"]


def test_norm_cdf_at_zero_is_half():
    assert abs(_norm_cdf(0) - 0.5) < 1e-9


def test_num_helper_accepts_various():
    assert _num("100") == 100.0
    assert _num(100) == 100.0
    assert _num(None) is None
    assert _num("") is None
    assert _num("abc") is None


def test_fmt_helper():
    assert _fmt(1_500_000_000).endswith("B")
    assert _fmt(15_000_000).endswith("M")
    assert _fmt(1_500).endswith("K")


# ------------ aggregate ------------
def test_aggregate_band_all_methods_agree():
    methods = {
        "recent_transaction": {"value_usd": 100},
        "market_multiples":   {"value_usd": 100},
        "vc_method":          {"value_usd": 105},
        "dcf":                {"value_usd": 95},
        "option_pricing":     {"value_usd": 100},
    }
    r = aggregate_band(methods)
    assert r["confidence"] == "high"
    assert 95 <= r["base_usd"] <= 105
    assert r["insufficient_data"] is False


def test_aggregate_band_wide_spread_lowers_confidence():
    methods = {
        "recent_transaction": {"value_usd": 100},
        "dcf":                {"value_usd": 10},
    }
    r = aggregate_band(methods)
    assert r["confidence"] == "low"


def test_aggregate_band_single_method():
    r = aggregate_band({"recent_transaction": {"value_usd": 100}})
    assert r["base_usd"] == 100
    assert r["confidence"] == "medium"


def test_aggregate_band_empty():
    r = aggregate_band({})
    assert r["insufficient_data"] is True
    assert r["confidence"] == "low"
    assert r["base_usd"] == 0


def test_aggregate_band_ignores_null_values():
    r = aggregate_band({
        "recent_transaction": {"value_usd": 100},
        "market_multiples":   {"value_usd": None},
    })
    assert "market_multiples" not in r["included_methods"]
    assert r["base_usd"] == 100


def test_compute_all_methods_returns_five_keys():
    r = compute_all_methods({})
    assert set(r.keys()) == {"recent_transaction", "market_multiples", "vc_method", "dcf", "option_pricing"}


# ------------ autofill (mocked) ------------
@pytest.mark.asyncio
async def test_autofill_workbench_happy_path():
    fake_output = {
        "recent_transaction": {"post_money_usd": 500_000_000, "round_type": "Series C", "time_decay_factor": 1.0},
        "market_multiples":   {"estimated_annual_revenue_usd": 50_000_000, "median_multiple": 8, "multiple_type": "EV/Revenue"},
        "vc_method":          {"projected_exit_revenue_usd": 200_000_000, "exit_multiple": 6, "years_to_exit": 5, "target_irr_pct": 25},
        "dcf":                {"year1_revenue_usd": 50_000_000, "revenue_growth_pct": 30, "ebitda_margin_pct": 25, "capex_pct_revenue": 5, "tax_rate_pct": 21, "terminal_growth_pct": 3, "wacc_pct": 12},
        "option_pricing":     {"enterprise_value_usd": 500_000_000, "total_preferred_liquidation_pref_usd": 100_000_000, "volatility_pct": 60, "time_to_liquidity_years": 3},
        "narrative": "Series C anchor is strongest signal.",
    }
    r = await autofill_workbench(
        company_name="Test",
        sector=None, one_liner=None, estimated_revenue=None, headquarters=None,
        brave_fn=AsyncMock(return_value=[{"url": "https://a.com", "title": "t", "snippet": "s"}]),
        perplexity_fn=AsyncMock(return_value={"text": "briefing", "citations": ["https://b.com"]}),
        claude_fn=AsyncMock(return_value=json.dumps(fake_output)),
        safe_json=lambda s: json.loads(s),
    )
    assert set(r["inputs"].keys()) == {"recent_transaction", "market_multiples", "vc_method", "dcf", "option_pricing"}
    assert r["inputs"]["recent_transaction"]["post_money_usd"] == 500_000_000
    assert r["narrative"] == "Series C anchor is strongest signal."
    assert len(r["sources"]) >= 2


@pytest.mark.asyncio
async def test_autofill_workbench_falls_back_on_claude_error():
    r = await autofill_workbench(
        company_name="Test",
        sector=None, one_liner=None, estimated_revenue=None, headquarters=None,
        brave_fn=AsyncMock(return_value=[]),
        perplexity_fn=AsyncMock(return_value={"text": "", "citations": []}),
        claude_fn=AsyncMock(side_effect=Exception("model down")),
        safe_json=lambda s: json.loads(s) if s else {},
    )
    # Fallback: empty inputs but valid shape
    assert set(r["inputs"].keys()) == {"recent_transaction", "market_multiples", "vc_method", "dcf", "option_pricing"}
    assert "unavailable" in r["narrative"].lower()


@pytest.mark.asyncio
async def test_extract_term_sheet_happy_path():
    fake = {
        "round_type": "Series B",
        "raised_usd": 15_000_000,
        "post_money_usd": 60_000_000,
        "total_preferred_liquidation_pref_usd": 20_000_000,
        "announced": "2024-06",
        "confidence": "high",
        "notes": "clean extraction",
    }
    r = await extract_term_sheet(
        pdf_text="Series B term sheet, $15M raise at $60M post-money…",
        claude_fn=AsyncMock(return_value=json.dumps(fake)),
        safe_json=lambda s: json.loads(s),
    )
    assert r["post_money_usd"] == 60_000_000
    assert r["confidence"] == "high"


@pytest.mark.asyncio
async def test_extract_term_sheet_empty_input():
    r = await extract_term_sheet(pdf_text="", claude_fn=AsyncMock(), safe_json=lambda s: {})
    assert r["error"] == "no_text"


def test_default_weights_sum_to_one():
    assert abs(sum(DEFAULT_WEIGHTS.values()) - 1.0) < 1e-9
