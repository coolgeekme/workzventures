import { useEffect, useState } from "react";
import { Leaf } from "@phosphor-icons/react";
import { computeHealthScore, tierForScore } from "../lib/plantHealth";

/**
 * Visualizes the vault's diligence findings as a single plant whose
 * condition tracks the computed health score: more/severer findings ->
 * a less healthy-looking plant. Purely derived from severity_breakdown,
 * no separate backend call.
 */
export default function VaultHealthPlant({ latestSnapshot, findingsCount, accentClass }) {
  const hasData = !!latestSnapshot;
  const { score, high, medium, low, total } = computeHealthScore(latestSnapshot?.severity_breakdown);
  const tier = hasData ? tierForScore(score) : null;
  const [loadedImage, setLoadedImage] = useState(null);

  useEffect(() => {
    if (!tier) return;
    setLoadedImage(tier.image);
  }, [tier?.image]);

  if (!hasData) {
    return (
      <div className="mt-6 wz-card p-10 text-center" data-testid="health-empty">
        <Leaf size={28} className="mx-auto mb-3 text-[var(--wz-text-tertiary)]" />
        <div className="font-display tracking-tight mb-1">No health reading yet</div>
        <p className="text-sm text-[var(--wz-text-secondary)] max-w-sm mx-auto">
          Run diligence findings on the Findings tab first — the plant's condition is derived from
          the severity of what's found there.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6" data-testid="health-tab-content">
      <div className="wz-card overflow-hidden">
        <div className="relative aspect-[2/3] bg-[var(--wz-surface)]">
          {loadedImage && (
            <img
              key={loadedImage}
              src={loadedImage}
              alt={`Company health visualized as a ${tier.label.toLowerCase()} plant`}
              className="absolute inset-0 w-full h-full object-cover animate-fadein"
              data-testid="health-plant-image"
            />
          )}
        </div>
        <div className="p-5 border-t border-[var(--wz-border)]">
          <div className="overline mb-1">Company health</div>
          <div className="flex items-baseline gap-2">
            <span className={`font-display text-2xl tracking-tight ${accentClass}`} data-testid="health-score">{score}</span>
            <span className="text-sm text-[var(--wz-text-secondary)]">/ 100 · {tier.label}</span>
          </div>
          <p className="text-xs text-[var(--wz-text-secondary)] mt-2 leading-relaxed">{tier.blurb}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="wz-card p-5">
          <div className="overline mb-3">What's driving this reading</div>
          <div className="flex items-center gap-2 flex-wrap text-xs mb-4">
            <span className="pill pill-negative">{high} high</span>
            <span className="pill pill-amber">{medium} medium</span>
            <span className="pill pill-gold">{low} low</span>
            <span className="text-[var(--wz-text-tertiary)] ml-1">{total} findings total</span>
          </div>
          <div className="space-y-2">
            {[
              { label: "High severity", count: high, tone: "bg-[var(--wz-negative)]" },
              { label: "Medium severity", count: medium, tone: "bg-[var(--wz-amber)]" },
              { label: "Low severity", count: low, tone: "bg-[var(--wz-gold)]" },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3 text-xs">
                <span className="w-28 text-[var(--wz-text-secondary)]">{row.label}</span>
                <div className="flex-1 h-1.5 rounded-full bg-[var(--wz-border)] overflow-hidden">
                  <div
                    className={`h-full ${row.tone}`}
                    style={{ width: `${total > 0 ? Math.round((row.count / total) * 100) : 0}%` }}
                  />
                </div>
                <span className="font-mono-wz text-[var(--wz-text-tertiary)] w-6 text-right">{row.count}</span>
              </div>
            ))}
          </div>
        </div>

        {latestSnapshot?.executive_summary && (
          <div className="wz-card p-5 border-l-2 border-[var(--wz-gold)]">
            <div className="overline mb-1">Executive summary</div>
            <p className="text-sm leading-relaxed">{latestSnapshot.executive_summary}</p>
          </div>
        )}

        <div className="wz-card p-5">
          <div className="overline mb-2">How the score works</div>
          <p className="text-xs text-[var(--wz-text-secondary)] leading-relaxed">
            Starts at 100 and subtracts per open finding — high severity costs the most, low severity
            barely moves the needle. It reflects the latest findings snapshot ({findingsCount} finding{findingsCount === 1 ? "" : "s"});
            re-run diligence on the Findings tab to refresh it.
          </p>
        </div>
      </div>
    </div>
  );
}
