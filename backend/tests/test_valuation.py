"""Unit tests for /app/backend/valuation.py — Phase E valuation module.

Uses AsyncMock for the LLM/search helpers so tests are deterministic and don't
consume Emergent LLM key credits.
"""

import json
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock

import pytest

from valuation import (
    _time_decay_factor,
    _months_since_iso,
    _merge_sources,
    _fallback_result,
    estimate_valuation,
)


def test_time_decay_curve():
    # Reference table from IPEV heuristic
    assert _time_decay_factor(0) == 1.0
    assert _time_decay_factor(3) == 1.0
    assert _time_decay_factor(6) == 1.0
    assert _time_decay_factor(9) == 0.85
    assert _time_decay_factor(12) == 0.85
    assert _time_decay_factor(18) == 0.65
    assert _time_decay_factor(24) == 0.65
    assert _time_decay_factor(30) == 0.40
    assert _time_decay_factor(40) == 0.20
    # None → conservative middle
    assert _time_decay_factor(None) == 0.6


def test_months_since_iso_parses_year_only():
    now = datetime.now(timezone.utc)
    last_year = now - timedelta(days=365)
    year_str = str(last_year.year)
    m = _months_since_iso(year_str)
    assert m is not None
    # Should be roughly between 6 and 18 months depending on time of test run
    assert 0 < m < 24


def test_months_since_iso_parses_yyyy_mm():
    now = datetime.now(timezone.utc)
    six_months_ago = now - timedelta(days=180)
    iso = f"{six_months_ago.year:04d}-{six_months_ago.month:02d}"
    m = _months_since_iso(iso)
    # Give it a wide tolerance (5–7 months)
    assert 5.0 <= m <= 7.5


def test_months_since_iso_returns_none_on_garbage():
    assert _months_since_iso(None) is None
    assert _months_since_iso("") is None
    assert _months_since_iso("not-a-date") is None


def test_merge_sources_dedupes_and_flags_provider():
    px = {"citations": ["https://a.com", "https://b.com"]}
    brave = [
        {"url": "https://a.com", "title": "A dup", "snippet": "..."},
        {"url": "https://c.com", "title": "C", "snippet": "hello"},
    ]
    out = _merge_sources(px, brave)
    urls = [s["url"] for s in out]
    assert urls == ["https://a.com", "https://b.com", "https://c.com"]
    assert out[0]["provider"] == "perplexity"
    assert out[2]["provider"] == "brave"
    assert out[2]["title"] == "C"


def test_fallback_result_shape():
    r = _fallback_result("Stealth Co", reason="test-reason", sources=[])
    assert r["aggregate"]["insufficient_data"] is True
    assert r["aggregate"]["confidence"] == "low"
    assert r["aggregate"]["low_usd"] > 0 and r["aggregate"]["high_usd"] > r["aggregate"]["low_usd"]
    assert r["currency"] == "USD"


@pytest.mark.asyncio
async def test_estimate_valuation_happy_path_recomputes_decay():
    """Model gives a raw post-money and an old announced date; the module
    must recompute months_since + adjusted_value regardless of what the model
    guessed, so numbers are provably consistent."""
    fake_model_output = {
        "recent_transaction": {
            "value_usd": 100_000_000,
            "round_type": "Series B",
            "raised_usd": 20_000_000,
            "post_money_usd": 100_000_000,
            "announced": "2023-06",           # ~2y+ old (test-time dependent)
            "months_since": 999,              # wrong on purpose — should be recomputed
            "time_decay_factor": 999,         # wrong on purpose
            "adjusted_value_usd": 999,        # wrong on purpose
            "confidence": "medium",
            "note": "Series B",
        },
        "market_multiples": {
            "value_usd": 80_000_000,
            "comparable_tickers": ["FOO", "BAR"],
            "median_multiple": 8.0,
            "multiple_type": "EV/Revenue",
            "estimated_annual_revenue_usd": 10_000_000,
            "revenue_basis": "headcount * $200k",
            "confidence": "medium",
            "note": "med",
        },
        "aggregate": {
            "low_usd": 70_000_000,
            "base_usd": 90_000_000,
            "high_usd": 110_000_000,
            "confidence": "medium",
            "insufficient_data": False,
            "summary": "band",
        },
    }
    brave_fn = AsyncMock(return_value=[{"url": "https://x.com", "title": "t", "snippet": "s"}])
    perplexity_fn = AsyncMock(return_value={"text": "briefing", "citations": ["https://y.com"]})
    claude_fn = AsyncMock(return_value=json.dumps(fake_model_output))
    safe_json = lambda s: json.loads(s)  # noqa: E731

    result = await estimate_valuation(
        company_name="TestCo",
        sector="SaaS",
        one_liner="Widgets as a service",
        estimated_revenue="$10M ARR",
        headquarters="Austin, TX",
        brave_fn=brave_fn,
        perplexity_fn=perplexity_fn,
        claude_fn=claude_fn,
        safe_json=safe_json,
    )
    tx = result["recent_transaction"]
    # months_since was recomputed from "2023-06" → should be > 18 months
    assert tx["months_since"] != 999
    assert tx["months_since"] > 18
    # decay must match the reference table
    assert tx["time_decay_factor"] in (0.65, 0.40, 0.20)
    # adjusted_value must equal post_money × decay (rounded)
    assert tx["adjusted_value_usd"] == round(100_000_000 * tx["time_decay_factor"])
    # aggregate + currency + as_of stamped
    assert result["currency"] == "USD"
    assert result["as_of"]
    assert result["aggregate"]["base_usd"] == 90_000_000
    # sources merged from both feeds
    assert any(s["provider"] == "perplexity" for s in result["sources"])
    assert any(s["provider"] == "brave" for s in result["sources"])


@pytest.mark.asyncio
async def test_estimate_valuation_falls_back_when_model_returns_junk():
    brave_fn = AsyncMock(return_value=[])
    perplexity_fn = AsyncMock(return_value={"text": "", "citations": []})
    # Model returns something without an "aggregate" key
    claude_fn = AsyncMock(return_value='{"garbage": true}')
    safe_json = lambda s: json.loads(s)  # noqa: E731

    result = await estimate_valuation(
        company_name="Ghost Inc",
        brave_fn=brave_fn, perplexity_fn=perplexity_fn,
        claude_fn=claude_fn, safe_json=safe_json,
    )
    assert result["aggregate"]["insufficient_data"] is True
    assert result["aggregate"]["confidence"] == "low"


@pytest.mark.asyncio
async def test_estimate_valuation_survives_claude_exception():
    brave_fn = AsyncMock(return_value=[{"url": "https://x.com", "title": "t", "snippet": "s"}])
    perplexity_fn = AsyncMock(return_value={"text": "", "citations": []})
    claude_fn = AsyncMock(side_effect=Exception("model 502"))
    safe_json = lambda s: json.loads(s)  # noqa: E731

    result = await estimate_valuation(
        company_name="Broken Co",
        brave_fn=brave_fn, perplexity_fn=perplexity_fn,
        claude_fn=claude_fn, safe_json=safe_json,
    )
    # Still returns a valid shape (fallback), never propagates the exception.
    assert result["aggregate"]["insufficient_data"] is True
    assert result["currency"] == "USD"


@pytest.mark.asyncio
async def test_estimate_valuation_survives_brave_and_perplexity_failing():
    """Both grounding feeds throw; module must still call Claude with an
    empty-evidence prompt and either return the model's answer or fall back."""
    brave_fn = AsyncMock(side_effect=Exception("brave 500"))
    perplexity_fn = AsyncMock(side_effect=Exception("pplx 500"))
    claude_fn = AsyncMock(return_value=json.dumps({
        "recent_transaction": {"value_usd": None, "confidence": "low", "note": "no data"},
        "market_multiples": {"value_usd": None, "confidence": "low", "note": "no data"},
        "aggregate": {
            "low_usd": 1_000_000, "base_usd": 5_000_000, "high_usd": 25_000_000,
            "confidence": "low", "insufficient_data": True, "summary": "no data",
        },
    }))
    safe_json = lambda s: json.loads(s)  # noqa: E731

    result = await estimate_valuation(
        company_name="Blackout Co",
        brave_fn=brave_fn, perplexity_fn=perplexity_fn,
        claude_fn=claude_fn, safe_json=safe_json,
    )
    assert result["aggregate"]["insufficient_data"] is True
    assert result["sources"] == []
