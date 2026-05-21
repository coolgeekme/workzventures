"""
Workz Ventures · Cryptographic Provenance Certificate
Generates a single-document audit artifact for a Vault deal:
  • Every notarized event (NDA / file upload / AI findings / inquiry status)
  • Per-event SHA-256 digest + creation time
  • Bitcoin block height (or 'pending') with mempool.space link
  • Per-file content_type, size, plaintext SHA-256
  • QR code → verification instructions
  • CLI verification snippet
"""
import io
from datetime import datetime
from typing import Any, Dict, List

import qrcode
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
    PageBreak, KeepTogether, HRFlowable,
)


# -----------------------------------------------------------------------------
# Brand palette — institutional "warm paper" with dark gold accent, fits the
# Workz Ventures identity (works on print).
# -----------------------------------------------------------------------------
PAPER = colors.HexColor("#FAFAF7")
INK = colors.HexColor("#1A1A19")
INK_SOFT = colors.HexColor("#575754")
INK_FAINT = colors.HexColor("#8A8A85")
GOLD = colors.HexColor("#9E7B45")
AMBER = colors.HexColor("#D97B00")
POSITIVE = colors.HexColor("#008A2E")
BORDER = colors.HexColor("#DCDCD5")


# -----------------------------------------------------------------------------
# Styles
# -----------------------------------------------------------------------------
def _styles() -> Dict[str, ParagraphStyle]:
    s = {}
    s["overline"] = ParagraphStyle(
        "overline", fontName="Helvetica-Bold", fontSize=7, textColor=GOLD,
        spaceAfter=4, leading=9, alignment=TA_LEFT,
    )
    s["h1"] = ParagraphStyle(
        "h1", fontName="Helvetica-Bold", fontSize=24, textColor=INK,
        leading=28, spaceAfter=4, alignment=TA_LEFT,
    )
    s["h2"] = ParagraphStyle(
        "h2", fontName="Helvetica-Bold", fontSize=12, textColor=INK,
        leading=16, spaceAfter=6, spaceBefore=10, alignment=TA_LEFT,
    )
    s["body"] = ParagraphStyle(
        "body", fontName="Helvetica", fontSize=9.5, textColor=INK,
        leading=14, alignment=TA_LEFT,
    )
    s["body_soft"] = ParagraphStyle(
        "body_soft", fontName="Helvetica", fontSize=9, textColor=INK_SOFT,
        leading=13, alignment=TA_LEFT,
    )
    s["small"] = ParagraphStyle(
        "small", fontName="Helvetica", fontSize=8, textColor=INK_SOFT,
        leading=11, alignment=TA_LEFT,
    )
    s["mono"] = ParagraphStyle(
        "mono", fontName="Courier", fontSize=8, textColor=INK,
        leading=11, alignment=TA_LEFT,
    )
    s["mono_small"] = ParagraphStyle(
        "mono_small", fontName="Courier", fontSize=7, textColor=INK_SOFT,
        leading=10, alignment=TA_LEFT,
    )
    s["pill_gold"] = ParagraphStyle(
        "pill_gold", fontName="Helvetica-Bold", fontSize=7, textColor=GOLD,
        leading=9, alignment=TA_LEFT, leftIndent=0,
    )
    s["footer"] = ParagraphStyle(
        "footer", fontName="Helvetica", fontSize=7, textColor=INK_FAINT,
        leading=10, alignment=TA_CENTER,
    )
    return s


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _fmt_dt(iso_str: str) -> str:
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M:%S UTC")
    except Exception:
        return iso_str or "—"


def _short_hash(h: str, head: int = 12, tail: int = 8) -> str:
    if not h or len(h) <= head + tail + 3:
        return h or ""
    return f"{h[:head]}…{h[-tail:]}"


def _qr_image(content: str, size_inches: float = 1.1) -> Image:
    qr = qrcode.QRCode(box_size=4, border=1)
    qr.add_data(content)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#1A1A19", back_color="#FAFAF7")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return Image(buf, width=size_inches * inch, height=size_inches * inch)


def _kind_label(kind: str) -> str:
    return {
        "nda.signature": "NDA Signature",
        "vault.file": "Vault File",
        "vault.findings": "AI Findings",
        "inquiry.status": "Inquiry Status",
        "audit_chain_checkpoint": "Audit Chain Checkpoint",
    }.get(kind, kind)


# -----------------------------------------------------------------------------
# Page chrome (called via onFirstPage / onLaterPages)
# -----------------------------------------------------------------------------
def _page_chrome(canvas, doc, *, cert_id: str):
    canvas.saveState()
    # Top hairline
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(0.7 * inch, LETTER[1] - 0.55 * inch, LETTER[0] - 0.7 * inch, LETTER[1] - 0.55 * inch)
    # Header overline + cert id
    canvas.setFont("Helvetica-Bold", 7)
    canvas.setFillColor(GOLD)
    canvas.drawString(0.7 * inch, LETTER[1] - 0.42 * inch, "WORKZ VENTURES · CRYPTOGRAPHIC PROVENANCE CERTIFICATE")
    canvas.setFillColor(INK_FAINT)
    canvas.setFont("Courier", 7)
    canvas.drawRightString(LETTER[0] - 0.7 * inch, LETTER[1] - 0.42 * inch, f"cert {cert_id}")
    # Footer
    canvas.setStrokeColor(BORDER)
    canvas.line(0.7 * inch, 0.6 * inch, LETTER[0] - 0.7 * inch, 0.6 * inch)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(INK_FAINT)
    canvas.drawString(0.7 * inch, 0.42 * inch, "Bitcoin-anchored via OpenTimestamps · verify yourself with: pip install opentimestamps-client && ots verify <file>.ots")
    canvas.drawRightString(LETTER[0] - 0.7 * inch, 0.42 * inch, f"page {doc.page}")
    canvas.restoreState()


# -----------------------------------------------------------------------------
# Public entry point
# -----------------------------------------------------------------------------
def build_provenance_pdf(
    *,
    cert_id: str,
    generated_at: str,
    room: Dict[str, Any],
    inquiry: Dict[str, Any],
    listing: Dict[str, Any],
    buyer: Dict[str, Any],
    seller: Dict[str, Any],
    files: List[Dict[str, Any]],
    proofs: List[Dict[str, Any]],
    findings: List[Dict[str, Any]],
    chain_head: Dict[str, Any],
    base_url: str,
) -> bytes:
    """Render the certificate PDF. Returns raw PDF bytes."""
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=LETTER,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.85 * inch,
        bottomMargin=0.85 * inch,
        title=f"Workz Provenance Certificate · {listing.get('name','')}",
        author="Workz Ventures",
    )

    story: List[Any] = []

    # --- Title block ---
    story.append(Paragraph("CRYPTOGRAPHIC TRANSPARENCY", st["overline"]))
    story.append(Paragraph(
        f"{listing.get('name', 'Deal')} · Provenance Certificate", st["h1"]
    ))
    story.append(Paragraph(
        f"Issued {_fmt_dt(generated_at)} · {len(proofs)} Bitcoin-anchored event{'s' if len(proofs) != 1 else ''}",
        st["body_soft"],
    ))
    story.append(Spacer(1, 0.18 * inch))

    # --- Parties + QR ---
    qr_payload = f"{base_url}/app/security · cert={cert_id} · room={room.get('id')}"
    qr = _qr_image(qr_payload, size_inches=1.05)
    party_rows = [
        [Paragraph("BUYER", st["overline"]), Paragraph("SELLER", st["overline"])],
        [
            Paragraph(
                f"<b>{buyer.get('name', '—')}</b><br/>{buyer.get('organization', '—')}<br/>"
                f"<font color='#575754'>{buyer.get('email','—')}</font>",
                st["body"],
            ),
            Paragraph(
                f"<b>{seller.get('name', '—')}</b><br/>{seller.get('organization', '—')}<br/>"
                f"<font color='#575754'>{seller.get('email','—')}</font>",
                st["body"],
            ),
        ],
    ]
    parties = Table(party_rows, colWidths=[3.2 * inch, 3.2 * inch])
    parties.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 3),
    ]))
    top = Table([[parties, qr]], colWidths=[6.4 * inch, 0.95 * inch])
    top.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(top)
    story.append(Spacer(1, 0.18 * inch))

    # --- NDA card ---
    nda_signed_name = room.get("nda_signed_name")
    nda_status = (
        f"<b>e-signed</b> by <i>{nda_signed_name}</i> on {_fmt_dt(room.get('nda_accepted_by_buyer_at'))}"
        if nda_signed_name else "<b>not signed</b>"
    )
    nda_table = Table(
        [[
            Paragraph("NON-DISCLOSURE AGREEMENT", st["overline"]),
            Paragraph(f"Inquiry status: <b>{inquiry.get('status','—')}</b>", st["small"]),
        ],
        [
            Paragraph(nda_status, st["body"]),
            Paragraph(
                f"Vault opened {_fmt_dt(room.get('created_at'))}<br/>"
                f"Vault id: <font face='Courier'>{room.get('id','—')[:18]}…</font>",
                st["small"],
            ),
        ]],
        colWidths=[4.0 * inch, 3.35 * inch],
    )
    nda_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F2F1EB")),
        ("BOX", (0, 0), (-1, -1), 0.4, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(nda_table)
    story.append(Spacer(1, 0.18 * inch))

    # --- Bitcoin event timeline (table) ---
    story.append(Paragraph("EVENT TIMELINE — BITCOIN-ANCHORED VIA OPENTIMESTAMPS", st["overline"]))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=4))

    if not proofs:
        story.append(Paragraph(
            "No notarized events yet for this Vault. Events are added automatically as the deal progresses (NDA sign, file uploads, AI findings, inquiry status changes).",
            st["body_soft"],
        ))
    else:
        header = [
            Paragraph("<b>EVENT</b>", st["small"]),
            Paragraph("<b>TIMESTAMP (UTC)</b>", st["small"]),
            Paragraph("<b>SHA-256 DIGEST</b>", st["small"]),
            Paragraph("<b>BITCOIN STATUS</b>", st["small"]),
        ]
        rows: List[List[Any]] = [header]
        # Sort chronologically
        proofs_sorted = sorted(proofs, key=lambda p: p.get("created_at", ""))
        for p in proofs_sorted:
            kind = _kind_label(p.get("kind", ""))
            label = p.get("label") or kind
            digest = p.get("digest_hex") or ""
            block = p.get("btc_block_height")
            status_html = (
                f"<font color='#008A2E'><b>block {int(block):,}</b></font>"
                if block else "<font color='#D97B00'>pending</font>"
            )
            rows.append([
                Paragraph(f"<b>{kind}</b><br/><font color='#575754' size='7'>{label[:55]}</font>", st["small"]),
                Paragraph(_fmt_dt(p.get("created_at")), st["mono_small"]),
                Paragraph(_short_hash(digest), st["mono_small"]),
                Paragraph(status_html, st["small"]),
            ])
        evt_table = Table(rows, colWidths=[2.1 * inch, 1.45 * inch, 2.0 * inch, 1.05 * inch], repeatRows=1)
        evt_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F2F1EB")),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, BORDER),
            ("LINEBELOW", (0, 1), (-1, -1), 0.25, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(evt_table)

    story.append(Spacer(1, 0.20 * inch))

    # --- File inventory ---
    if files:
        story.append(Paragraph("VAULT FILE INVENTORY", st["overline"]))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=4))
        f_header = [
            Paragraph("<b>FILENAME</b>", st["small"]),
            Paragraph("<b>FOLDER</b>", st["small"]),
            Paragraph("<b>SIZE</b>", st["small"]),
            Paragraph("<b>SHA-256</b>", st["small"]),
            Paragraph("<b>ENC</b>", st["small"]),
        ]
        f_rows: List[List[Any]] = [f_header]
        for f in sorted(files, key=lambda x: x.get("uploaded_at", "")):
            size_kb = f"{(f.get('size_bytes') or 0) / 1024:.1f} KB"
            f_rows.append([
                Paragraph(f"{f.get('filename', '')}<br/><font size='7' color='#8A8A85'>{_fmt_dt(f.get('uploaded_at'))}</font>", st["small"]),
                Paragraph(f.get("folder", "—"), st["small"]),
                Paragraph(size_kb, st["mono_small"]),
                Paragraph(_short_hash(f.get("sha256_hex") or "—", head=10, tail=6), st["mono_small"]),
                Paragraph("AES-GCM" if f.get("encrypted") else "—", st["small"]),
            ])
        f_table = Table(f_rows, colWidths=[2.45 * inch, 1.0 * inch, 0.7 * inch, 1.85 * inch, 0.6 * inch], repeatRows=1)
        f_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F2F1EB")),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, BORDER),
            ("LINEBELOW", (0, 1), (-1, -1), 0.25, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(f_table)
        story.append(Spacer(1, 0.20 * inch))

    # --- AI findings summary (if any) ---
    if findings:
        story.append(Paragraph(f"AI DILIGENCE FINDINGS ({len(findings)})", st["overline"]))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=4))
        for f in findings[:8]:
            sev = (f.get("severity") or "medium").upper()
            sev_color = "#D92D20" if sev == "HIGH" else ("#D97B00" if sev == "MEDIUM" else "#008A2E")
            cit = f.get("citation") or {}
            cit_str = ""
            if cit.get("filename"):
                cit_str = f" · cited from <font face='Courier' size='7'>{cit['filename']}{(' · p.' + str(cit['page'])) if cit.get('page') else ''}</font>"
            story.append(Paragraph(
                f"<font color='{sev_color}'><b>{sev}</b></font> · <b>{f.get('workstream','')}</b> · {f.get('title','')}",
                st["body"],
            ))
            story.append(Paragraph(
                f"<font color='#575754'>{(f.get('description') or '')[:280]}</font>{cit_str}",
                st["small"],
            ))
            story.append(Spacer(1, 0.06 * inch))
        if len(findings) > 8:
            story.append(Paragraph(
                f"… plus {len(findings) - 8} additional finding(s) — view inside the platform.",
                st["small"],
            ))
        story.append(Spacer(1, 0.18 * inch))

    # --- Audit chain anchor ---
    if chain_head:
        story.append(Paragraph("AUDIT-LOG CHAIN ANCHOR (TAMPER-EVIDENT)", st["overline"]))
        story.append(HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=4))
        story.append(Paragraph(
            f"Platform audit chain head at issuance time: <b>seq {chain_head.get('last_seq','—')}</b> · "
            f"<font face='Courier'>{(chain_head.get('last_hash') or '—')[:48]}…</font> · "
            f"{_fmt_dt(chain_head.get('last_ts',''))}",
            st["small"],
        ))
        story.append(Paragraph(
            "Workz publishes the audit chain head to Bitcoin every 25 entries via OpenTimestamps. "
            "Combined with each entry's SHA-256 + prev-hash continuity, no historical event can be "
            "altered without detection.",
            st["body_soft"],
        ))
        story.append(Spacer(1, 0.18 * inch))

    # --- How to verify ---
    story.append(KeepTogether([
        Paragraph("HOW TO VERIFY THIS CERTIFICATE", st["overline"]),
        HRFlowable(width="100%", thickness=0.5, color=BORDER, spaceAfter=4),
        Paragraph(
            "Every SHA-256 digest above corresponds to a downloadable <font face='Courier'>.ots</font> "
            "OpenTimestamps proof retrievable from the Workz Security Console. Anyone — including a "
            "court, regulator, or counterparty — can independently verify each anchored event using:",
            st["body"],
        ),
        Spacer(1, 0.06 * inch),
        Table([[Paragraph(
            "<font face='Courier' size='8'>"
            "pip install opentimestamps-client<br/>"
            "ots verify workz-vault.file-&lt;digest&gt;.ots --no-bitcoin-node"
            "</font>",
            st["mono"],
        )]], colWidths=[7.1 * inch], style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F2F1EB")),
            ("BOX", (0, 0), (-1, -1), 0.4, BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ])),
        Spacer(1, 0.08 * inch),
        Paragraph(
            "Verification succeeds if (a) the proof parses, (b) the embedded SHA-256 matches the file you hold, "
            "and (c) the proof's Merkle path resolves into a confirmed Bitcoin block. "
            "Bitcoin attestations typically land within 1–6 hours of the original notarization.",
            st["body_soft"],
        ),
    ]))

    # Build with chrome
    doc.build(
        story,
        onFirstPage=lambda c, d: _page_chrome(c, d, cert_id=cert_id),
        onLaterPages=lambda c, d: _page_chrome(c, d, cert_id=cert_id),
    )
    return buf.getvalue()
