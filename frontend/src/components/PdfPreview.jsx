import { useEffect, useState, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { X, ArrowsClockwise, MagnifyingGlassPlus, MagnifyingGlassMinus, CaretLeft, CaretRight, CloudArrowDown, Warning } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// pdf.js worker — load from the same package as react-pdf to avoid version drift.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/**
 * In-browser PDF preview modal with a watermark overlay carrying the viewer's
 * identity. Used for institutional VDR-style "view-only" file inspection:
 * the buyer can browse the document without downloading, but every visible
 * frame is overprinted with their email + a timestamp so any screenshot
 * traces back to who took it.
 *
 * Props:
 *  - open: bool
 *  - onClose: () => void
 *  - roomId: vault id
 *  - file: { id, filename, content_type, download_allowed }
 *  - onDownload: optional callback (only invoked if file.download_allowed)
 */
export default function PdfPreview({ open, onClose, roomId, file, onDownload }) {
  const { user } = useAuth();
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [containerWidth, setContainerWidth] = useState(720);
  const containerRef = useRef(null);

  // Static watermark text — captured at modal-open time so a single viewing
  // session shows a consistent stamp. Includes UTC timestamp + email + a
  // session token suffix so two screenshots from the same buyer at different
  // times can be distinguished forensically.
  const wmRef = useRef(null);
  if (open && !wmRef.current) {
    const stamp = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
    const sessionId = Math.random().toString(36).slice(2, 8).toUpperCase();
    wmRef.current = `${user?.email || "anon"} · ${stamp} · ${sessionId}`;
  }
  if (!open) wmRef.current = null;

  useEffect(() => {
    if (!open || !file?.id) return;
    let active = true;
    setLoading(true);
    setErrorMsg(null);
    setPageNumber(1);
    setPageCount(0);
    setBlobUrl(null);
    (async () => {
      try {
        const resp = await api.get(`/deal-rooms/${roomId}/files/${file.id}/preview`, {
          responseType: "blob",
        });
        if (!active) return;
        const blob = new Blob([resp.data], { type: "application/pdf" });
        setBlobUrl(window.URL.createObjectURL(blob));
      } catch (e) {
        if (!active) return;
        setErrorMsg(e?.response?.data?.detail || "Preview unavailable for this file.");
        setLoading(false);
      }
    })();
    return () => {
      active = false;
      if (blobUrl) window.URL.revokeObjectURL(blobUrl);
    };
  }, [open, file?.id, roomId]);

  // Measure modal width for responsive page sizing.
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      if (containerRef.current) {
        const w = containerRef.current.getBoundingClientRect().width;
        if (w > 0) setContainerWidth(Math.min(Math.max(w - 80, 400), 1100));
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  // ESC to close, arrow keys to navigate pages, +/- for zoom.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setPageNumber((p) => Math.min(p + 1, pageCount || 1));
      else if (e.key === "ArrowLeft") setPageNumber((p) => Math.max(p - 1, 1));
      else if (e.key === "+" || e.key === "=") setScale((s) => Math.min(s + 0.2, 2.4));
      else if (e.key === "-") setScale((s) => Math.max(s - 0.2, 0.4));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, pageCount]);

  if (!open) return null;

  const downloadAllowed = !!file?.download_allowed;
  const wm = wmRef.current || "watermark";

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/85 backdrop-blur-sm"
      data-testid="pdf-preview-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        className="relative my-6 mx-4 sm:mx-8 max-w-6xl w-full bg-[var(--wz-card-bg,#0E0E12)] border border-[var(--wz-border)] rounded-md flex flex-col"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--wz-border)]">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--wz-text-tertiary)]">View-only preview</div>
            <div className="text-sm font-medium text-white truncate" title={file?.filename}>{file?.filename}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setScale((s) => Math.max(s - 0.2, 0.4))}
              className="p-1.5 text-[var(--wz-text-secondary)] hover:text-white border border-[var(--wz-border)] hover:border-white rounded-sm"
              data-testid="pdf-zoom-out"
              aria-label="Zoom out"
            ><MagnifyingGlassMinus size={14} /></button>
            <span className="text-xs font-mono-wz text-[var(--wz-text-tertiary)] w-12 text-center">{Math.round(scale * 100)}%</span>
            <button
              onClick={() => setScale((s) => Math.min(s + 0.2, 2.4))}
              className="p-1.5 text-[var(--wz-text-secondary)] hover:text-white border border-[var(--wz-border)] hover:border-white rounded-sm"
              data-testid="pdf-zoom-in"
              aria-label="Zoom in"
            ><MagnifyingGlassPlus size={14} /></button>
            {downloadAllowed && (
              <button
                onClick={() => onDownload?.()}
                className="px-3 py-1.5 text-xs text-[var(--wz-gold)] border border-[var(--wz-gold)] hover:bg-[var(--wz-gold)] hover:text-black rounded-sm inline-flex items-center gap-1.5 transition-colors"
                data-testid="pdf-download-from-preview"
              ><CloudArrowDown size={13} /> Download</button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-[var(--wz-text-secondary)] hover:text-white border border-[var(--wz-border)] hover:border-white rounded-sm"
              data-testid="pdf-preview-close"
              aria-label="Close preview"
            ><X size={14} /></button>
          </div>
        </div>

        {/* Page strip */}
        <div className="px-4 py-2 border-b border-[var(--wz-border)] flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPageNumber((p) => Math.max(p - 1, 1))}
              disabled={pageNumber <= 1}
              className="p-1 text-[var(--wz-text-secondary)] hover:text-white disabled:opacity-40"
              data-testid="pdf-prev-page"
              aria-label="Previous page"
            ><CaretLeft size={14} /></button>
            <span className="font-mono-wz text-[var(--wz-text-tertiary)]" data-testid="pdf-page-indicator">
              Page <span className="text-white">{pageNumber}</span> / {pageCount || "—"}
            </span>
            <button
              onClick={() => setPageNumber((p) => Math.min(p + 1, pageCount || 1))}
              disabled={pageNumber >= pageCount}
              className="p-1 text-[var(--wz-text-secondary)] hover:text-white disabled:opacity-40"
              data-testid="pdf-next-page"
              aria-label="Next page"
            ><CaretRight size={14} /></button>
          </div>
          {!downloadAllowed && (
            <span className="pill text-[10px]" style={{ background: "rgba(245,158,11,0.10)", color: "var(--wz-amber, #F59E0B)", border: "1px solid var(--wz-amber, #F59E0B)" }}>
              View-only · ask the seller to enable download
            </span>
          )}
        </div>

        {/* Document area with watermark overlay */}
        <div className="relative flex-1 overflow-auto bg-[#1A1A1F] flex justify-center py-6 px-4 select-none">
          {errorMsg && (
            <div className="m-auto max-w-md text-center" data-testid="pdf-preview-error">
              <Warning size={28} className="text-[var(--wz-amber, #F59E0B)] mx-auto mb-2" />
              <div className="text-sm text-white">Preview unavailable</div>
              <div className="text-xs text-[var(--wz-text-secondary)] mt-1">{errorMsg}</div>
            </div>
          )}

          {!errorMsg && blobUrl && (
            <Document
              file={blobUrl}
              onLoadSuccess={({ numPages }) => {
                setPageCount(numPages);
                setLoading(false);
              }}
              onLoadError={(err) => {
                setErrorMsg(err?.message || "Failed to parse PDF");
                setLoading(false);
              }}
              loading={<div className="text-sm text-[var(--wz-text-secondary)] m-auto">Loading preview…</div>}
            >
              <div className="relative inline-block">
                <Page
                  pageNumber={pageNumber}
                  width={containerWidth}
                  scale={scale}
                  renderAnnotationLayer={false}
                  renderTextLayer={true}
                  className="shadow-xl"
                />
                {/* Watermark overlay — diagonal, repeating, semi-transparent.
                    Pure CSS so it can't be stripped via right-click "save image as".
                    Positioned absolutely over the page so it captures into screenshots. */}
                <div
                  className="absolute inset-0 pointer-events-none overflow-hidden"
                  aria-hidden="true"
                  data-testid="pdf-watermark"
                >
                  <div
                    className="absolute -inset-1/2 flex flex-wrap content-center justify-center"
                    style={{
                      transform: "rotate(-30deg)",
                      opacity: 0.16,
                      color: "#1D4ED8",
                      fontFamily: "ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace",
                      fontSize: "13px",
                      letterSpacing: "0.05em",
                      lineHeight: "70px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {Array.from({ length: 60 }).map((_, i) => (
                      <span key={i} className="mx-8" style={{ width: "260px", textAlign: "center" }}>
                        {wm}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Document>
          )}

          {!errorMsg && !blobUrl && loading && (
            <div className="text-sm text-[var(--wz-text-secondary)] m-auto inline-flex items-center gap-2">
              <ArrowsClockwise size={14} className="animate-spin" /> Loading preview…
            </div>
          )}
        </div>

        {/* Footer — trust line */}
        <div className="px-4 py-2.5 border-t border-[var(--wz-border)] text-[11px] text-[var(--wz-text-tertiary)] flex items-center justify-between">
          <span>Every page is watermarked with your email + a session ID. Every preview is logged in the Vault audit trail.</span>
          <span className="font-mono-wz hidden sm:inline">{wm}</span>
        </div>
      </div>
    </div>
  );
}
