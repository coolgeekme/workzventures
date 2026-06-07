import {
  LinkedinLogo, TwitterLogo, GithubLogo, YoutubeLogo, InstagramLogo,
  Buildings, ArrowSquareOut, Globe,
} from "@phosphor-icons/react";

/**
 * SocialStrip — renders the company's social/community presence with lightweight
 * signals (followers, employees, repos, etc.) discovered from Brave search.
 *
 * Props:
 *   profiles: { linkedin?: {...}, twitter?: {...}, github?: {...}, ... }
 *   compact:  boolean — set true for the Research Hub brief (3-icon strip);
 *             false renders the full multi-card layout used in Detailed Analysis.
 */

const META = {
  linkedin:    { label: "LinkedIn",     Icon: LinkedinLogo,  signal: (p) => p.followers || p.employees },
  twitter:     { label: "X (Twitter)",  Icon: TwitterLogo,   signal: (p) => p.followers },
  github:      { label: "GitHub",       Icon: GithubLogo,    signal: (p) => p.stars ? `${p.stars} ★` : (p.repos ? `${p.repos} repos` : null) },
  youtube:     { label: "YouTube",      Icon: YoutubeLogo,   signal: (p) => p.subscribers },
  crunchbase:  { label: "Crunchbase",   Icon: Buildings,     signal: () => null },
  producthunt: { label: "Product Hunt", Icon: Globe,         signal: (p) => p.upvotes ? `${p.upvotes} upvotes` : null },
  instagram:   { label: "Instagram",    Icon: InstagramLogo, signal: (p) => p.followers },
};

const ORDER = ["linkedin", "twitter", "github", "youtube", "crunchbase", "producthunt", "instagram"];

export default function SocialStrip({ profiles, compact = false }) {
  if (!profiles || typeof profiles !== "object") return null;
  const entries = ORDER.filter((k) => profiles[k]?.url).map((k) => [k, profiles[k]]);
  if (entries.length === 0) return null;

  if (compact) {
    return (
      <div className="flex items-center flex-wrap gap-2 mt-4" data-testid="social-strip-compact">
        <span className="overline mr-1">Social presence</span>
        {entries.map(([k, p]) => {
          const { label, Icon, signal } = META[k];
          const sig = signal?.(p);
          return (
            <a
              key={k}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              title={`${label}${sig ? ` · ${sig}` : ""}`}
              data-testid={`social-${k}`}
              className="inline-flex items-center gap-1.5 px-2 py-1 border border-[var(--wz-border)] hover:border-[var(--wz-amber)] hover:text-[var(--wz-text)] text-xs"
            >
              <Icon size={13} weight="regular" />
              <span className="truncate max-w-[120px]">{sig || label}</span>
            </a>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3" data-testid="social-grid">
      {entries.map(([k, p]) => {
        const { label, Icon, signal } = META[k];
        const sig = signal?.(p);
        return (
          <a
            key={k}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            data-testid={`social-${k}`}
            className="group border border-[var(--wz-border)] hover:border-[var(--wz-amber)] p-3 transition-colors flex items-start gap-3 min-w-0"
          >
            <Icon size={20} className="text-[var(--wz-amber)] shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-sm font-medium">{label}</span>
                <ArrowSquareOut size={10} className="text-[var(--wz-text-tertiary)] group-hover:text-[var(--wz-amber)]" />
              </div>
              {sig && <div className="text-xs font-mono-wz text-[var(--wz-amber)]">{sig}</div>}
              <div className="text-[10px] font-mono-wz text-[var(--wz-text-tertiary)] truncate mt-0.5">
                {(p.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 60)}
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
