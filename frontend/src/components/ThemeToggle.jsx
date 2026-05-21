import { Moon, Sun, Monitor } from "@phosphor-icons/react";
import { useTheme } from "../lib/theme";

const NEXT_LABEL = {
  dark: "Switch to light",
  light: "Switch to system",
  auto: "Switch to dark",
};

export default function ThemeToggle({ size = 18, className = "", testId = "theme-toggle-btn" }) {
  const { preference, cycle } = useTheme();
  const Icon = preference === "dark" ? Moon : preference === "light" ? Sun : Monitor;
  return (
    <button
      type="button"
      onClick={cycle}
      data-testid={testId}
      aria-label={NEXT_LABEL[preference]}
      title={`Theme: ${preference} · click to ${NEXT_LABEL[preference].toLowerCase()}`}
      className={`h-10 w-10 inline-flex items-center justify-center rounded-sm text-[var(--wz-text-secondary)] hover:text-[var(--wz-text)] hover:bg-[var(--wz-surface-hover)] border border-transparent hover:border-[var(--wz-border)] transition-colors ${className}`}
    >
      <Icon size={size} weight={preference === "auto" ? "regular" : "regular"} />
    </button>
  );
}
