"""Unit tests for the vault-grounded autofill enhancement (Iter-38).

Covers the `private_evidence` code path in `autofill_workbench()`:
  * Prompt correctly labels vault text as AUTHORITATIVE
  * Sources merger appends vault files with `provider='private_vault'`
  * Response carries `private_grounded=True` + `vault_files_used`
"""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from valuation_workbench import autofill_workbench


@pytest.mark.asyncio
async def test_autofill_marks_private_grounded_when_evidence_provided():
    claude_seen_prompt = {}

    async def fake_claude(system, user):
        claude_seen_prompt["system"] = system
        claude_seen_prompt["user"] = user
        return json.dumps({
            "recent_transaction": {"post_money_usd": 300_000_000, "time_decay_factor": 1.0},
            "market_multiples": {"estimated_annual_revenue_usd": 40_000_000, "median_multiple": 6},
            "vc_method": {"projected_exit_revenue_usd": 100_000_000, "exit_multiple": 8, "years_to_exit": 5, "target_irr_pct": 25},
            "dcf": {"year1_revenue_usd": 40_000_000, "revenue_growth_pct": 30, "ebitda_margin_pct": 20, "capex_pct_revenue": 5, "tax_rate_pct": 21, "terminal_growth_pct": 3, "wacc_pct": 14},
            "option_pricing": {"enterprise_value_usd": 300_000_000, "total_preferred_liquidation_pref_usd": 80_000_000, "volatility_pct": 55, "time_to_liquidity_years": 3},
            "narrative": "Vault-anchored analysis.",
        })

    result = await autofill_workbench(
        company_name="Helios MedTech",
        sector="HealthTech",
        one_liner=None, estimated_revenue=None, headquarters=None,
        brave_fn=AsyncMock(return_value=[{"url": "https://x.com", "title": "t", "snippet": "s"}]),
        perplexity_fn=AsyncMock(return_value={"text": "briefing", "citations": []}),
        claude_fn=fake_claude,
        safe_json=lambda s: json.loads(s),
        private_evidence="Q4 revenue: $40M. Series B post-money: $300M announced 2024-11.",
        private_evidence_files=[
            {"id": "f1", "filename": "Q4_financials.md", "priority": "FINANCIALS"},
            {"id": "f2", "filename": "cap_table.xlsx", "priority": "CAP_TABLE"},
        ],
    )
    # Response fields
    assert result["private_grounded"] is True
    assert len(result["vault_files_used"]) == 2
    assert result["vault_files_used"][0]["filename"] == "Q4_financials.md"
    # Prompt built correctly — should include private evidence marker + text
    assert "PRIVATE DATA ROOM EVIDENCE (AUTHORITATIVE)" in claude_seen_prompt["user"]
    assert "Q4 revenue: $40M" in claude_seen_prompt["user"]
    assert "END PRIVATE EVIDENCE" in claude_seen_prompt["user"]
    # Sources include a private_vault entry
    providers = {s.get("provider") for s in result["sources"]}
    assert "private_vault" in providers


@pytest.mark.asyncio
async def test_autofill_without_evidence_is_not_private_grounded():
    result = await autofill_workbench(
        company_name="PublicCo",
        sector=None, one_liner=None, estimated_revenue=None, headquarters=None,
        brave_fn=AsyncMock(return_value=[]),
        perplexity_fn=AsyncMock(return_value={"text": "", "citations": []}),
        claude_fn=AsyncMock(return_value=json.dumps({
            "recent_transaction": {"post_money_usd": 100_000_000, "time_decay_factor": 1.0},
            "market_multiples": {"estimated_annual_revenue_usd": 10_000_000, "median_multiple": 5},
            "vc_method": {},
            "dcf": {},
            "option_pricing": {},
            "narrative": "Public-only.",
        })),
        safe_json=lambda s: json.loads(s),
    )
    assert result["private_grounded"] is False
    assert result["vault_files_used"] == []
    assert not any(s.get("provider") == "private_vault" for s in result["sources"])


@pytest.mark.asyncio
async def test_autofill_truncates_very_long_private_evidence():
    """Prompt cap is 12k chars — feed 20k, ensure only ~12k lands in the prompt."""
    huge = "X" * 20_000
    seen = {}
    async def fake_claude(sys, u):
        seen["user"] = u
        return json.dumps({
            "recent_transaction": {}, "market_multiples": {}, "vc_method": {}, "dcf": {},
            "option_pricing": {}, "aggregate": {}, "narrative": "",
            "recent_transaction": {"post_money_usd": 100_000_000, "time_decay_factor": 1.0},
        })
    await autofill_workbench(
        company_name="Test",
        sector=None, one_liner=None, estimated_revenue=None, headquarters=None,
        brave_fn=AsyncMock(return_value=[]),
        perplexity_fn=AsyncMock(return_value={"text": "", "citations": []}),
        claude_fn=fake_claude,
        safe_json=lambda s: json.loads(s),
        private_evidence=huge,
        private_evidence_files=[],
    )
    # The X-run in the prompt should be dramatically fewer than input (truncated)
    xrun = seen["user"].count("X")
    assert xrun < 15_000, f"Prompt was NOT truncated — got {xrun} X's"
    assert xrun >= 10_000, f"Truncation cut too aggressively — got only {xrun} X's"
