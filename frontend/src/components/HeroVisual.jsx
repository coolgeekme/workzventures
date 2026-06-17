/**
 * NextCapOS hero visual — fully self-contained SVG composition.
 *
 * Replaces the old raster image that had "WORKZ VENTURES" lettering
 * baked into it. Renders crisp at any size, theme-aware (picks up
 * --wz-bg / --wz-gold / --wz-border CSS variables), and dynamic with
 * subtle animation.
 *
 * Layered composition:
 *   1. Deep terminal background (#08080A in dark, paper in light)
 *   2. Faint blueprint grid
 *   3. Three "tickers" — animated horizontal lines moving at different speeds
 *      with translucent blue traces. Suggests live data without being literal.
 *   4. Centered blueprint of the brand mark — two overlapping squares
 *      (oversized) anchoring the composition.
 *   5. Bottom-right monospace caption: "NEXTCAPOS · MARKETING OS FOR M&A"
 */
export default function HeroVisual() {
  return (
    <div
      className="absolute inset-0"
      data-testid="hero-visual"
      style={{ backgroundColor: "var(--wz-bg)" }}
    >
      {/* Blueprint grid */}
      <svg
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <pattern id="hero-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path
              d="M 32 0 L 0 0 0 32"
              fill="none"
              stroke="var(--wz-border)"
              strokeWidth="0.6"
              opacity="0.55"
            />
          </pattern>
          <radialGradient id="hero-glow" cx="50%" cy="40%" r="55%">
            <stop offset="0%" stopColor="var(--wz-gold)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--wz-gold)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Blueprint grid fills entire canvas */}
        <rect width="100%" height="100%" fill="url(#hero-grid)" />
        {/* Soft brand glow */}
        <rect width="100%" height="100%" fill="url(#hero-glow)" />

        {/* Three horizontal ticker lines — symbolize live market data */}
        <g>
          <line x1="0" y1="22%" x2="100%" y2="22%"
            stroke="var(--wz-gold)" strokeWidth="0.6" opacity="0.35"
            strokeDasharray="3 8">
            <animate attributeName="stroke-dashoffset" from="0" to="-200" dur="14s" repeatCount="indefinite" />
          </line>
          <line x1="0" y1="50%" x2="100%" y2="50%"
            stroke="var(--wz-amber)" strokeWidth="0.6" opacity="0.45"
            strokeDasharray="2 12">
            <animate attributeName="stroke-dashoffset" from="0" to="-300" dur="22s" repeatCount="indefinite" />
          </line>
          <line x1="0" y1="78%" x2="100%" y2="78%"
            stroke="var(--wz-gold)" strokeWidth="0.6" opacity="0.3"
            strokeDasharray="4 6">
            <animate attributeName="stroke-dashoffset" from="0" to="-180" dur="18s" repeatCount="indefinite" />
          </line>
        </g>

        {/* Centered oversized brand mark (blueprint outline + filled overlay) */}
        <g transform="translate(50%, 50%)">
          <g transform="translate(-130, -110)">
            {/* Back outline rect */}
            <rect x="0" y="60" width="170" height="170" rx="6"
              fill="none" stroke="var(--wz-gold)" strokeWidth="1.5" opacity="0.45" />
            {/* Front rect — filled, full brand color */}
            <rect x="80" y="0" width="170" height="170" rx="6"
              fill="var(--wz-gold)" opacity="0.85" />
            {/* Subtle interior detail lines on the front */}
            <line x1="80" y1="40" x2="250" y2="40"
              stroke="var(--wz-bg)" strokeWidth="0.8" opacity="0.35" />
            <line x1="80" y1="130" x2="250" y2="130"
              stroke="var(--wz-bg)" strokeWidth="0.8" opacity="0.35" />
          </g>
        </g>

        {/* Corner reticles for that terminal/blueprint feel */}
        <g stroke="var(--wz-gold)" strokeWidth="0.8" opacity="0.55" fill="none">
          <path d="M 20 20 L 20 40 M 20 20 L 40 20" />
          <path d="M calc(100% - 40px) 20 l 20 0 l 0 20" />
          <path d="M 20 calc(100% - 40px) l 0 20 l 20 0" />
          <path d="M calc(100% - 40px) calc(100% - 20px) l 20 0 l 0 -20" />
        </g>
      </svg>

      {/* Caption + ticker readout, bottom-left */}
      <div className="absolute bottom-5 left-5 sm:bottom-6 sm:left-6 font-mono-wz text-[10px] sm:text-[11px] uppercase tracking-widest text-[var(--wz-text-tertiary)] leading-relaxed">
        <div className="text-[var(--wz-gold)]">NextCap<span style={{ color: "var(--wz-text)" }}>OS</span></div>
        <div className="opacity-70">marketing OS for M&amp;A</div>
        <div className="opacity-50 mt-1">build · {new Date().toISOString().substring(0, 10)}</div>
      </div>
    </div>
  );
}
