/**
 * NextCapOS brand mark (SVG, inline — no external asset).
 *
 * Design: two offset stacked rectangles forming an abstract "OS window /
 * capital stack" mark. Both squares fill with the primary brand blue
 * (`--wz-gold` CSS variable, currently Bloomberg terminal blue). Pairs
 * with a monospaced "NEXTCAPOS" wordmark on the right.
 *
 * Renders crisply at any size (vector). Self-contained so we don't depend
 * on a hosted PNG anymore — no rebrand can break the logo again.
 */
import React from "react";

// Kept for backwards-compat with any old imports referencing the asset URL.
// New code should use <Logo /> directly.
export const WORKZ_LOGO_URL = "";
export const WORKZ_HERO_URL = "";

const SIZES = {
  xs: 22,
  sm: 30,
  md: 42,
  lg: 60,
  xl: 92,
  "2xl": 132,
};

/**
 * SVG geometric mark only (no wordmark). Useful in tight corners where the
 * full logo is too wide.
 */
export function BrandMark({ size = 32, className = "" }) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      role="img"
    >
      {/* Outer / back rectangle, slightly dimmer */}
      <rect
        x="4" y="10" width="22" height="22"
        rx="2"
        fill="var(--wz-gold)"
        opacity="0.55"
      />
      {/* Front / overlay rectangle, full intensity */}
      <rect
        x="14" y="4" width="22" height="22"
        rx="2"
        fill="var(--wz-gold)"
      />
      {/* Subtle cut highlight to give it depth */}
      <rect
        x="14" y="4" width="22" height="3"
        rx="1.5"
        fill="white"
        opacity="0.18"
      />
    </svg>
  );
}

export default function Logo({
  size = "sm",
  className = "",
  square = false,        // legacy prop — kept for callers, ignored visually
  testid = "wz-logo",
  showWordmark = true,
}) {
  const px = SIZES[size] ?? SIZES.sm;
  const wordmarkSize = Math.round(px * 0.42);
  return (
    <span
      className={`select-none inline-flex items-center gap-2 ${className}`}
      data-testid={testid}
      style={{ height: px }}
    >
      <BrandMark size={px} />
      {showWordmark && (
        <span
          className="font-display font-medium tracking-tighter leading-none"
          style={{ fontSize: wordmarkSize, color: "var(--wz-text)" }}
        >
          NextCap<span style={{ color: "var(--wz-gold)" }}>OS</span>
        </span>
      )}
    </span>
  );
}
