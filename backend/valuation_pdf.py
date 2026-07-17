"""Valuation Memorandum PDF Generator — Phase A.

Builds an audit-ready PDF using reportlab, with sections:
  1. Cover
  2. Executive Summary (fair value band + methodology overview)
  3. Method-by-method sections (5 methods)
  4. Assumptions Log
  5. Sources Appendix
  6. ASC 820 disclaimer footer on every page

Called by `POST /api/valuations/{id}/snapshots/{sid}/pdf` in server.py.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether,
)


# NextCapOS "Bloomberg Blue" palette
NAVY = HexColor("#0A1628")
GOLD = HexColor("#D4A946")
TEXT = HexColor("#1A2332")
MUTED = HexColor("#5A6478")
BORDER = HexColor("#D0D5DE")


METHOD_LABELS = {
    "recent_transaction": "Recent Transaction Method",
    "market_multiples":   "Market Multiples Method",
    "vc_method":          "Venture Capital Method",
    "dcf":                "Discounted Cash Flow (DCF)",
    "option_pricing":     "Option Pricing Method (Black-Scholes)",
}


def _fmt_usd(n) -> str:
    if n is None or n == "":
        return "—"
    try:
        v = float(n)
    except (TypeError, ValueError):
        return "—"
    if abs(v) >= 1e9:
        return f"${v/1e9:.2f}B"
    if abs(v) >= 1e6:
        return f"${v/1e6:.1f}M"
    if abs(v) >= 1e3:
        return f"${v/1e3:.0f}K"
    return f"${v:.0f}"


DISCLAIMER = (
    "PREPARED IN ACCORDANCE WITH ASC 820 (Fair Value Measurement) and the International Private "
    "Equity and Venture Capital Valuation (IPEV) Guidelines. Fair values reported herein are "
    "estimates as of the measurement date and reflect unobservable inputs (Level 3). Actual "
    "realizable values may differ materially. This memorandum is prepared for the exclusive use "
    "of the NextCapOS-designated Valuation Committee and authorized reviewers. Not for public "
    "distribution."
)


def _header_footer(canvas, doc, *, company_name: str, snapshot_id: str):
    """Header + footer on every page (except cover)."""
    canvas.saveState()
    # Footer line
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(0.75 * inch, 0.55 * inch, LETTER[0] - 0.75 * inch, 0.55 * inch)
    # Left: disclaimer stub
    canvas.setFont("Helvetica", 6.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(0.75 * inch, 0.4 * inch, "Confidential · ASC 820 / IPEV compliant · Level 3 (unobservable)")
    canvas.drawString(0.75 * inch, 0.28 * inch, f"Snapshot: {snapshot_id[:8]}  ·  Page {canvas.getPageNumber()}")
    # Right: company name
    canvas.drawRightString(LETTER[0] - 0.75 * inch, 0.4 * inch, company_name)
    canvas.drawRightString(LETTER[0] - 0.75 * inch, 0.28 * inch, "NextCapOS · Valuation Memorandum")
    canvas.restoreState()


def build_memo_pdf(
    *,
    valuation: dict,
    snapshot: dict,
    prepared_by: str,
    firm_name: str = "NextCapOS",
) -> bytes:
    """Return the memo PDF as raw bytes."""
    company = valuation.get("company_name") or "Portfolio Company"
    sector = valuation.get("sector") or "—"
    hq = valuation.get("headquarters") or "—"

    outputs = snapshot.get("outputs") or {}
    inputs = snapshot.get("inputs") or {}
    aggregate = snapshot.get("aggregate") or {}
    narrative = snapshot.get("narrative") or ""
    sources = snapshot.get("sources") or []
    weights_used = aggregate.get("weights_used") or {}
    measurement_date = snapshot.get("created_at") or datetime.now(timezone.utc).isoformat()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=LETTER,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
        topMargin=0.6 * inch, bottomMargin=0.7 * inch,
        title=f"Valuation Memorandum — {company}",
        author=firm_name,
    )

    ss = getSampleStyleSheet()
    h_title = ParagraphStyle("Title", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=22, textColor=NAVY, alignment=TA_CENTER, spaceAfter=8)
    h_sub = ParagraphStyle("Sub", parent=ss["Normal"], fontName="Helvetica", fontSize=10, textColor=MUTED, alignment=TA_CENTER, spaceAfter=4)
    h1 = ParagraphStyle("H1", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=13, textColor=NAVY, spaceBefore=16, spaceAfter=8, borderPadding=0)
    h2 = ParagraphStyle("H2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=10.5, textColor=NAVY, spaceBefore=10, spaceAfter=4)
    body = ParagraphStyle("Body", parent=ss["Normal"], fontName="Helvetica", fontSize=9.5, textColor=TEXT, leading=13, alignment=TA_LEFT, spaceAfter=6)
    small = ParagraphStyle("Small", parent=ss["Normal"], fontName="Helvetica", fontSize=8, textColor=MUTED, leading=11, spaceAfter=4)
    kicker = ParagraphStyle("Kicker", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=GOLD, spaceAfter=2)

    story: list[Any] = []

    # =============== COVER ===============
    story.append(Spacer(1, 1.5 * inch))
    story.append(Paragraph("VALUATION MEMORANDUM", kicker))
    story.append(Paragraph(company, h_title))
    story.append(Paragraph(f"Sector: {sector} · HQ: {hq}", h_sub))
    story.append(Spacer(1, 0.4 * inch))

    # Big fair-value figure
    base = aggregate.get("base_usd")
    lo = aggregate.get("low_usd")
    hi = aggregate.get("high_usd")
    conf = (aggregate.get("confidence") or "medium").upper()
    band_style = ParagraphStyle("Band", parent=body, fontSize=28, alignment=TA_CENTER, textColor=GOLD, fontName="Helvetica-Bold", leading=32, spaceAfter=4)
    band_sub = ParagraphStyle("BandSub", parent=body, fontSize=11, alignment=TA_CENTER, textColor=NAVY, spaceAfter=2)
    story.append(Paragraph(_fmt_usd(base), band_style))
    story.append(Paragraph(f"Fair Value Range: <b>{_fmt_usd(lo)} — {_fmt_usd(hi)}</b> USD", band_sub))
    story.append(Paragraph(f"Confidence: {conf}", h_sub))

    story.append(Spacer(1, 0.6 * inch))
    story.append(_kv_table([
        ("Prepared By", prepared_by or "—"),
        ("Firm", firm_name),
        ("Measurement Date", measurement_date[:10]),
        ("Methodology", "IPEV Guidelines · ASC 820 Level 3"),
        ("Snapshot ID", (snapshot.get("id") or "")[:12]),
    ]))

    story.append(Spacer(1, 0.4 * inch))
    story.append(Paragraph(DISCLAIMER, small))

    story.append(PageBreak())

    # =============== EXECUTIVE SUMMARY ===============
    story.append(Paragraph("EXECUTIVE SUMMARY", h1))
    if narrative:
        story.append(Paragraph(narrative, body))
    story.append(Paragraph(aggregate.get("summary") or "", body))

    story.append(Paragraph("Methodology contribution", h2))
    if weights_used:
        rows = [["Method", "Value", "Weight"]]
        for k in ("recent_transaction", "market_multiples", "vc_method", "dcf", "option_pricing"):
            if k not in weights_used:
                continue
            rows.append([
                METHOD_LABELS.get(k, k),
                _fmt_usd((outputs.get(k) or {}).get("value_usd")),
                f"{weights_used[k] * 100:.1f}%",
            ])
        story.append(_data_table(rows, col_widths=[3.0 * inch, 1.4 * inch, 1.0 * inch]))
    else:
        story.append(Paragraph("No methods produced a defensible value.", body))

    story.append(PageBreak())

    # =============== METHOD SECTIONS ===============
    for key in ("recent_transaction", "market_multiples", "vc_method", "dcf", "option_pricing"):
        m_in = inputs.get(key) or {}
        m_out = outputs.get(key) or {}
        story.append(Paragraph(METHOD_LABELS.get(key, key), h1))
        val = m_out.get("value_usd")
        story.append(Paragraph(
            f"<b>Method result:</b> <font color='#D4A946'>{_fmt_usd(val)}</font>",
            body,
        ))
        if m_out.get("notes"):
            story.append(Paragraph(m_out["notes"], body))

        rows = _method_input_rows(key, m_in, m_out)
        if rows:
            story.append(Paragraph("Inputs & derived values", h2))
            story.append(_data_table([["Field", "Value"]] + rows, col_widths=[2.6 * inch, 3.8 * inch]))
        story.append(Spacer(1, 0.15 * inch))

    story.append(PageBreak())

    # =============== ASSUMPTIONS LOG ===============
    story.append(Paragraph("ASSUMPTIONS LOG", h1))
    assumptions_rows = [["Method", "Key Assumption", "Rationale"]]
    for key in ("recent_transaction", "market_multiples", "vc_method", "dcf", "option_pricing"):
        m_out = outputs.get(key) or {}
        m_in = inputs.get(key) or {}
        note = m_out.get("notes") or m_in.get("notes") or ""
        if not note:
            continue
        assumptions_rows.append([METHOD_LABELS.get(key, key), _first_clause(note), _rest_clause(note)])
    if len(assumptions_rows) > 1:
        story.append(_data_table(assumptions_rows, col_widths=[1.6 * inch, 2.2 * inch, 2.6 * inch]))
    else:
        story.append(Paragraph("No assumptions logged.", body))

    # =============== SOURCES ===============
    if sources:
        story.append(Paragraph("SOURCES APPENDIX", h1))
        for i, s in enumerate(sources[:40], 1):
            title = (s.get("title") or s.get("url") or "").strip()[:130]
            url = s.get("url") or ""
            prov = (s.get("provider") or "").upper()
            story.append(Paragraph(
                f"<font color='#D4A946'>[{i}]</font> <b>{prov}</b> · {title} · <font color='#5A6478'>{url}</font>",
                small,
            ))

    doc.build(
        story,
        onFirstPage=lambda c, d: _header_footer(c, d, company_name=company, snapshot_id=snapshot.get("id") or ""),
        onLaterPages=lambda c, d: _header_footer(c, d, company_name=company, snapshot_id=snapshot.get("id") or ""),
    )
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _kv_table(rows: list[tuple[str, str]]) -> Table:
    data = [[k, v] for k, v in rows]
    t = Table(data, colWidths=[1.5 * inch, 3.5 * inch], hAlign="CENTER")
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), TEXT),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LINEABOVE", (0, 0), (-1, 0), 0.4, BORDER),
        ("LINEBELOW", (0, -1), (-1, -1), 0.4, BORDER),
    ]))
    return t


def _data_table(rows: list[list[str]], col_widths: list[float]) -> Table:
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#FFFFFF")),
        ("TEXTCOLOR", (0, 1), (-1, -1), TEXT),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def _method_input_rows(key: str, m_in: dict, m_out: dict) -> list[list[str]]:
    """Compose a small key/value table of important inputs + derived outputs
    per method. Keeps the layout consistent and skips null cells."""
    rows: list[list[str]] = []

    def add(label: str, val, *, money: bool = False, pct: bool = False, suffix: str = ""):
        if val is None or val == "" or val == "—":
            return
        if money:
            s = _fmt_usd(val)
        elif pct:
            s = f"{val}%"
        else:
            s = f"{val}{suffix}"
        rows.append([label, s])

    if key == "recent_transaction":
        add("Round type", m_in.get("round_type"))
        add("Announced", m_in.get("announced"))
        add("Raised", m_in.get("raised_usd"), money=True)
        add("Post-money", m_in.get("post_money_usd"), money=True)
        add("Time-decay factor", m_in.get("time_decay_factor"), suffix="x")
        add("Adjusted value", m_out.get("adjusted_value_usd"), money=True)
    elif key == "market_multiples":
        tickers = ", ".join(m_in.get("comparable_tickers") or []) or None
        add("Comparables", tickers)
        add("Multiple type", m_in.get("multiple_type"))
        add("Median multiple", m_in.get("median_multiple"), suffix="x")
        add("Estimated annual revenue", m_in.get("estimated_annual_revenue_usd"), money=True)
        add("Size discount", m_in.get("size_discount_pct"), pct=True)
    elif key == "vc_method":
        add("Projected exit revenue", m_in.get("projected_exit_revenue_usd"), money=True)
        add("Exit multiple", m_in.get("exit_multiple"), suffix="x")
        add("Years to exit", m_in.get("years_to_exit"), suffix="y")
        add("Target IRR", m_in.get("target_irr_pct"), pct=True)
        add("Current ownership", m_in.get("current_ownership_pct"), pct=True)
        add("Terminal value", m_out.get("terminal_value_usd"), money=True)
        add("Present value", m_out.get("present_value_usd"), money=True)
    elif key == "dcf":
        add("Year-1 revenue", m_in.get("year1_revenue_usd"), money=True)
        add("Revenue growth", m_in.get("revenue_growth_pct"), pct=True)
        add("EBITDA margin", m_in.get("ebitda_margin_pct"), pct=True)
        add("Capex % of revenue", m_in.get("capex_pct_revenue"), pct=True)
        add("Tax rate", m_in.get("tax_rate_pct"), pct=True)
        add("Terminal growth", m_in.get("terminal_growth_pct"), pct=True)
        add("WACC", m_in.get("wacc_pct"), pct=True)
        add("PV of 5-yr FCFs", m_out.get("pv_of_5yr_cash_flows_usd"), money=True)
        add("Terminal value", m_out.get("terminal_value_usd"), money=True)
        add("PV of terminal", m_out.get("pv_of_terminal_usd"), money=True)
    elif key == "option_pricing":
        add("Enterprise value", m_in.get("enterprise_value_usd"), money=True)
        add("Preferred liquidation pref", m_in.get("total_preferred_liquidation_pref_usd"), money=True)
        add("Volatility (σ)", m_in.get("volatility_pct"), pct=True)
        add("Time to liquidity", m_in.get("time_to_liquidity_years"), suffix="y")
        add("Risk-free rate", m_in.get("risk_free_rate_pct"), pct=True)
        add("Common class value", m_out.get("common_class_value_usd"), money=True)
        add("Preferred class value", m_out.get("preferred_class_value_usd"), money=True)
    return rows


def _first_clause(s: str) -> str:
    return (s.split(".", 1)[0] or s)[:120]


def _rest_clause(s: str) -> str:
    parts = s.split(".", 1)
    return (parts[1].strip() if len(parts) > 1 else "")[:180] or "—"
