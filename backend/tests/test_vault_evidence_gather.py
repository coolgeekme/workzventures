"""Regression tests for the AZpme $0-band bug fix (Iter-43).

Two invariants the fix must guarantee:
  1. FINANCIALS filename detection widens to catch real-world names like
     income_statement, EBITDA, 10-K, annual_report, actuals, Q3, arr, etc.
  2. High-priority (TERM_SHEET / CAP_TABLE / FINANCIALS) files get more
     characters than OTHER (boilerplate) files so real numbers reach Claude.

Directly imports the helper from server.py to exercise `_gather_vault_private_evidence`
against synthetic Mongo docs.
"""

import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_gather_evidence_widens_financial_regex():
    """Real-world filenames like income_statement.xlsx, EBITDA_projections.xlsx,
    10-K.pdf must land in FINANCIALS priority — not OTHER."""
    from server import _gather_vault_private_evidence

    fake_files = [
        {
            "id": "1", "filename": "income_statement_2024.xlsx", "folder": "financial",
            "pages": [{"page": 1, "text": "Revenue: $45M · EBITDA: $8M"}],
            "content": "",
        },
        {
            "id": "2", "filename": "Q3_actuals_and_projections.xlsx", "folder": "financial",
            "pages": [{"page": 1, "text": "Q3 revenue $12M, gross margin 68%"}],
            "content": "",
        },
        {
            "id": "3", "filename": "annual_report_2024.pdf", "folder": "corp",
            "pages": [{"page": 1, "text": "FY24 revenue $45M · net income $6M"}],
            "content": "",
        },
        {
            "id": "4", "filename": "NDA_template.pdf", "folder": "corp",
            "pages": [{"page": 1, "text": "This NDA is confidential"}],
            "content": "",
        },
    ]

    class FakeCursor:
        def __init__(self, docs): self.docs = docs
        def sort(self, *a, **kw): return self
        async def to_list(self, n): return self.docs

    with patch("server.db") as fake_db:
        fake_db.deal_room_files.find = lambda *a, **kw: FakeCursor(fake_files)
        text, used = await _gather_vault_private_evidence("room1")

    priorities = [u["priority"] for u in used]
    assert priorities[0] in ("FINANCIALS", "TERM_SHEET", "CAP_TABLE"), \
        f"First file should be high-priority, got {priorities[0]}"
    # NDA should land last (OTHER), not first
    nda_idx = [u["filename"] for u in used].index("NDA_template.pdf")
    assert nda_idx == len(used) - 1, "NDA should be OTHER (last), not high-priority"
    # All three financial docs should be FINANCIALS
    fin_files = [u for u in used if u["priority"] == "FINANCIALS"]
    assert len(fin_files) >= 3, f"Expected 3+ FINANCIALS matches, got {len(fin_files)}: {used}"


@pytest.mark.asyncio
async def test_gather_evidence_gives_more_chars_to_priority_files():
    """Priority docs get all their pages; OTHER caps at 3 pages × 400 chars."""
    from server import _gather_vault_private_evidence

    big_text = "REVENUE " * 400  # ~3200 chars
    fake_files = [
        {
            "id": "1", "filename": "financial_model.xlsx", "folder": "fin",
            "pages": [{"page": i, "text": big_text} for i in range(1, 8)],  # 7 pages
            "content": "",
        },
        {
            "id": "2", "filename": "misc_boilerplate.pdf", "folder": "corp",
            "pages": [{"page": i, "text": big_text} for i in range(1, 8)],  # 7 pages
            "content": "",
        },
    ]

    class FakeCursor:
        def __init__(self, docs): self.docs = docs
        def sort(self, *a, **kw): return self
        async def to_list(self, n): return self.docs

    with patch("server.db") as fake_db:
        fake_db.deal_room_files.find = lambda *a, **kw: FakeCursor(fake_files)
        text, used = await _gather_vault_private_evidence("room1")

    # Split evidence blocks — priority block should be MUCH bigger than boilerplate
    priority_block = [b for b in text.split("---") if "financial_model" in b][0]
    other_block = [b for b in text.split("---") if "misc_boilerplate" in b][0]
    assert len(priority_block) > len(other_block) * 3, (
        f"Priority block ({len(priority_block)} chars) should be >>3x boilerplate ({len(other_block)} chars). "
        "Regression on per-file budget."
    )
    # Should also carry Revenue text into evidence
    assert "REVENUE" in priority_block


@pytest.mark.asyncio
async def test_gather_evidence_empty_room_returns_empty():
    from server import _gather_vault_private_evidence

    class FakeCursor:
        def sort(self, *a, **kw): return self
        async def to_list(self, n): return []

    with patch("server.db") as fake_db:
        fake_db.deal_room_files.find = lambda *a, **kw: FakeCursor()
        text, used = await _gather_vault_private_evidence("empty-room")
    assert text == ""
    assert used == []


@pytest.mark.asyncio
async def test_gather_evidence_falls_back_to_content_field_when_pages_empty():
    """Some file rows have `content: '...'` but `pages: []` (e.g. auto-attached
    detailed reports). We must still surface their content, not skip them."""
    from server import _gather_vault_private_evidence

    fake_files = [
        {
            "id": "1", "filename": "10-K_filing.pdf", "folder": "sec",
            "pages": [],  # no page-level extraction
            "content": "FY 2024 Total revenues: $250 million · EBITDA: $45M",
        },
    ]

    class FakeCursor:
        def __init__(self, docs): self.docs = docs
        def sort(self, *a, **kw): return self
        async def to_list(self, n): return self.docs

    with patch("server.db") as fake_db:
        fake_db.deal_room_files.find = lambda *a, **kw: FakeCursor(fake_files)
        text, used = await _gather_vault_private_evidence("room1")
    assert "$250 million" in text
    assert used[0]["priority"] == "FINANCIALS"  # 10-K should be FINANCIALS now
