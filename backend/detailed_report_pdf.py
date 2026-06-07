"""Detailed-analysis PDF export. Re-uses the brand palette + ReportStyle helpers
from `provenance.py` to stay visually consistent with the Provenance Certificate."""
from __future__ import annotations

import io
from datetime import datetime
from typing import Any, Dict, List

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable,
)

from provenance import PAPER, INK, INK_SOFT, INK_FAINT, GOLD, AMBER, POSITIVE, BORDER


RECOMMENDATION_COLOR = {
    "strong-buy": POSITIVE, "buy": POSITIVE,
    "hold": AMBER, "pass": colors.HexColor("#C44A2A"),
}


def _styles() -> Dict[str, ParagraphStyle]:
    s = {}
    s["overline"] = ParagraphStyle("overline", fontName="Helvetica-Bold", fontSize=7,
                                   textColor=GOLD, spaceAfter=4, leading=9, alignment=TA_LEFT)
    s["h1"] = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=22, textColor=INK,
                             leading=26, spaceAfter=8)
    s["h2"] = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=13, textColor=INK,
                             leading=16, spaceBefore=16, spaceAfter=8)
    s["h3"] = ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=10, textColor=GOLD,
                             leading=12, spaceBefore=10, spaceAfter=4,
                             letterSpacing=1.2, alignment=TA_LEFT)
    s["body"] = ParagraphStyle("body", fontName="Helvetica", fontSize=9, textColor=INK,
                               leading=13, spaceAfter=4)
    s["bullet"] = ParagraphStyle("bullet", fontName="Helvetica", fontSize=9, textColor=INK,
                                 leading=13, leftIndent=12, bulletIndent=2, spaceAfter=2)
    s["mono"] = ParagraphStyle("mono", fontName="Courier", fontSize=7.5, textColor=INK_SOFT,
                               leading=10)
    s["caption"] = ParagraphStyle("caption", fontName="Helvetica-Oblique", fontSize=7.5,
                                  textColor=INK_FAINT, leading=10)
    return s


def _kv_table(rows: List[tuple], style):
    data = [[Paragraph(k, style["overline"]), Paragraph(str(v or "—"), style["body"])] for k, v in rows]
    t = Table(data, colWidths=[1.4 * inch, 4.8 * inch])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def _bullets(items: List[str], style, key="bullet") -> List:
    out = []
    for it in items or []:
        if it:
            out.append(Paragraph(f"&#8226;&nbsp;&nbsp;{it}", style[key]))
    return out


def _section_title(text: str, style) -> List:
    return [Paragraph(text.upper(), style["h3"]),
            HRFlowable(width="100%", thickness=0.4, color=BORDER, spaceAfter=6)]


def generate_detailed_report_pdf(report: Dict[str, Any]) -> bytes:
    """Render the detailed analysis to a polished PDF. `report` is the persisted Mongo doc."""
    data = report.get("data") or {}
    sources = report.get("sources") or []
    social = report.get("social_profiles") or {}
    style = _styles()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=0.7 * inch, rightMargin=0.7 * inch,
        topMargin=0.7 * inch, bottomMargin=0.7 * inch,
        title=f"Detailed Analysis · {report.get('company_name', 'Company')}",
        author="Workz Ventures",
    )
    flow: List = []

    # ---- Header
    flow.append(Paragraph("WORKZ VENTURES &nbsp;·&nbsp; DETAILED ANALYSIS", style["overline"]))
    flow.append(Paragraph(report.get("company_name", "Untitled"), style["h1"]))

    es = data.get("executiveSummary") or {}
    rec = (es.get("recommendation") or "hold").lower()
    rec_color = RECOMMENDATION_COLOR.get(rec, INK_SOFT)
    headline_row = Table(
        [[Paragraph(rec.upper().replace("-", " "), ParagraphStyle(
            "rec", fontName="Helvetica-Bold", fontSize=10, textColor=colors.white,
            backColor=rec_color, leading=14, alignment=TA_CENTER, borderPadding=4))]],
        colWidths=[1.4 * inch],
    )
    headline_row.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    flow.append(headline_row)
    flow.append(Spacer(1, 6))
    if es.get("headline"):
        flow.append(Paragraph(f"<b>{es['headline']}</b>", style["body"]))
    flow.append(Spacer(1, 8))

    flow.append(_kv_table([
        ("Industry", report.get("industry")),
        ("Region", report.get("region")),
        ("Website", report.get("company_url")),
        ("Funding stage", report.get("funding_stage")),
        ("Generated", report.get("created_at", "").replace("T", " ")[:19] + " UTC"),
        ("Sources", f"{report.get('source_count', 0)} live web citations"),
    ], style))

    # ---- Executive summary
    flow.extend(_section_title("Executive summary", style))
    if es.get("investmentThesis"):
        flow.append(Paragraph(es["investmentThesis"], style["body"]))
    metrics = es.get("keyMetrics") or {}
    flow.append(Spacer(1, 6))
    flow.append(_kv_table([
        ("Revenue", metrics.get("revenue")),
        ("Growth", metrics.get("growth")),
        ("Valuation", metrics.get("valuation")),
        ("Employees", metrics.get("employees")),
    ], style))

    # ---- Company overview
    co = data.get("companyOverview") or {}
    flow.extend(_section_title("Company overview", style))
    flow.append(_kv_table([
        ("Description", co.get("description")),
        ("Business model", co.get("businessModel")),
        ("Value proposition", co.get("valueProposition")),
        ("Target market", co.get("targetMarket")),
        ("Revenue model", co.get("revenueModel")),
        ("Geographic presence", co.get("geographicPresence")),
        ("Founded", co.get("foundedYear")),
        ("Headquarters", co.get("headquarters")),
        ("Founders", ", ".join(co.get("founders") or []) if isinstance(co.get("founders"), list) else co.get("founders")),
        ("Customer base", co.get("customerBase")),
        ("Product-market fit", co.get("productMarketFit")),
    ], style))

    # ---- Market analysis
    ma = data.get("marketAnalysis") or {}
    flow.extend(_section_title("Market analysis", style))
    flow.append(_kv_table([
        ("TAM", ma.get("tam")), ("SAM", ma.get("sam")),
        ("Market size", ma.get("marketSize")), ("Growth rate", ma.get("marketGrowthRate")),
        ("Regulatory environment", ma.get("regulatoryEnvironment")),
    ], style))

    # ---- Competitive landscape
    cl = data.get("competitiveLandscape") or {}
    flow.extend(_section_title("Competitive landscape", style))
    flow.append(_kv_table([
        ("Positioning", cl.get("marketPositioning")),
        ("Moat", cl.get("competitiveMoat")),
        ("Market share", cl.get("marketShare")),
        ("Switching costs", cl.get("switchingCosts")),
    ], style))
    flow.append(Paragraph("Direct competitors", style["overline"]))
    flow.extend(_bullets(cl.get("directCompetitors") or [], style))
    if cl.get("indirectCompetitors"):
        flow.append(Paragraph("Indirect competitors", style["overline"]))
        flow.extend(_bullets(cl.get("indirectCompetitors") or [], style))
    flow.append(Paragraph("Competitive advantages", style["overline"]))
    flow.extend(_bullets(cl.get("competitiveAdvantages") or [], style))
    if cl.get("threats"):
        flow.append(Paragraph("Threats", style["overline"]))
        flow.extend(_bullets(cl.get("threats") or [], style))

    # ---- Financial analysis
    fa = data.get("financialAnalysis") or {}
    flow.extend(_section_title("Financial analysis", style))
    flow.append(_kv_table([
        ("Revenue growth", fa.get("revenueGrowth")),
        ("Profitability", fa.get("profitabilityMetrics")),
        ("Burn rate", fa.get("burnRate")),
        ("Funding history", fa.get("fundingHistory")),
        ("Projections", fa.get("projections")),
    ], style))

    # ---- Management
    mt = data.get("managementTeam") or {}
    flow.extend(_section_title("Management team", style))
    flow.append(_kv_table([
        ("Founder background", mt.get("founderBackground")),
        ("Executive team", mt.get("executiveTeam")),
        ("Board composition", mt.get("boardComposition")),
        ("Team gaps", mt.get("teamGaps")),
    ], style))

    # ---- Tech / IP
    ti = data.get("technologyIP") or {}
    flow.extend(_section_title("Technology & IP", style))
    flow.append(_kv_table([
        ("Technology stack", ti.get("technologyStack")),
        ("IP portfolio", ti.get("ipPortfolio")),
        ("Patents", ti.get("patents")),
        ("R&D capabilities", ti.get("rdCapabilities")),
    ], style))

    # ---- Social presence
    if social:
        flow.extend(_section_title("Social & community presence", style))
        social_rows: List[tuple] = []
        for key, label in [("linkedin", "LinkedIn"), ("twitter", "X (Twitter)"),
                           ("github", "GitHub"), ("youtube", "YouTube"),
                           ("crunchbase", "Crunchbase"), ("producthunt", "Product Hunt"),
                           ("instagram", "Instagram")]:
            p = social.get(key)
            if not p or not p.get("url"):
                continue
            sig_parts = []
            for sk in ("followers", "employees", "subscribers", "stars", "repos", "upvotes"):
                if p.get(sk):
                    sig_parts.append(f"{p[sk]} {sk}")
            sig = " · ".join(sig_parts) if sig_parts else ""
            social_rows.append((label, f"{p['url']}{(' — ' + sig) if sig else ''}"))
        flow.append(_kv_table(social_rows, style))

    flow.append(PageBreak())

    # ---- Risk assessment
    ra = data.get("riskAssessment") or {}
    flow.extend(_section_title("Risk assessment", style))
    for label, key in [("Market", "marketRisks"), ("Operational", "operationalRisks"),
                       ("Financial", "financialRisks"), ("Technology", "technologyRisks"),
                       ("Regulatory", "regulatoryRisks")]:
        items = ra.get(key) or []
        if not items:
            continue
        flow.append(Paragraph(label, style["overline"]))
        flow.extend(_bullets(items, style))

    # ---- Compliance & legal
    cle = data.get("complianceAndLegal") or {}
    if any(cle.values()):
        flow.extend(_section_title("Compliance & legal", style))
        flow.append(_kv_table([
            ("Compliance status", cle.get("complianceStatus")),
            ("Regulatory violations", cle.get("regulatoryViolations")),
            ("Legal proceedings", cle.get("legalProceedings")),
            ("International compliance", cle.get("internationalCompliance")),
            ("Executive backgrounds", cle.get("executiveBackgrounds")),
        ], style))

    # ---- Valuation
    val = data.get("valuation") or {}
    if any(val.values()):
        flow.extend(_section_title("Valuation", style))
        flow.append(_kv_table([
            ("Current valuation", val.get("currentValuation")),
            ("Comparable analysis", val.get("comparableAnalysis")),
            ("Fair-value range", val.get("fairValueRange")),
            ("Methodology", val.get("methodology")),
        ], style))

    # ---- Key strengths / risks / recommendations
    strengths = data.get("keyStrengths") or []
    risks = data.get("keyRisks") or []
    recs = data.get("strategicRecommendations") or []
    if strengths or risks or recs:
        flow.extend(_section_title("Buyer takeaways", style))
        if strengths:
            flow.append(Paragraph("Key strengths", style["overline"]))
            flow.extend(_bullets(strengths, style))
        if risks:
            flow.append(Paragraph("Key risks", style["overline"]))
            flow.extend(_bullets(risks, style))
        if recs:
            flow.append(Paragraph("Strategic recommendations", style["overline"]))
            flow.extend(_bullets(recs, style))

    # ---- Due diligence questions
    dd = data.get("dueDiligenceQuestions") or {}
    if any(dd.values()):
        flow.extend(_section_title("Due-diligence questions", style))
        for label, key in [("Financial", "financial"), ("Market", "market"),
                           ("Technology", "technology"), ("Team", "team"),
                           ("Legal", "legal")]:
            items = dd.get(key) or []
            if not items:
                continue
            flow.append(Paragraph(label, style["overline"]))
            flow.extend(_bullets(items, style))

    # ---- Sources
    if sources:
        flow.append(PageBreak())
        flow.extend(_section_title(f"Sources ({len(sources)})", style))
        for s in sources:
            line = f"[{s.get('index')}] {(s.get('title') or s.get('url') or '')[:120]} — <font color='#575754'>{s.get('url','')}</font>"
            flow.append(Paragraph(line, style["mono"]))
            if s.get("snippet"):
                flow.append(Paragraph(s["snippet"][:240], style["caption"]))
            flow.append(Spacer(1, 4))

    # ---- Footer note
    flow.append(Spacer(1, 16))
    flow.append(HRFlowable(width="100%", thickness=0.4, color=BORDER, spaceAfter=4))
    flow.append(Paragraph(
        f"Generated by Workz Ventures · {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')} · "
        f"Hash anchored on the Bitcoin blockchain via OpenTimestamps for tamper-evidence.",
        style["caption"],
    ))

    doc.build(flow)
    return buf.getvalue()
