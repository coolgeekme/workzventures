/**
 * Iter-48 — Verify the more-critical scoring scale (high=12, medium=4, low=1).
 * These tests act as the canonical spec so any future rebalance is intentional
 * (they'll fail loudly if PENALTY values drift).
 *
 * Score/tier logic is shared across visualization styles (plant, weather) —
 * parametrized below so both stay in lockstep with the same band boundaries.
 */
const { computeHealthScore, tierForScore, VIZ_STYLES } = require("../lib/healthVisualization");

const STYLES = Object.keys(VIZ_STYLES);

describe("healthVisualization — Iter-48 diligence-tuned scale", () => {
  test("no findings → perfect 100 / Excellent", () => {
    const r = computeHealthScore({ high: 0, medium: 0, low: 0 });
    expect(r.score).toBe(100);
    STYLES.forEach((style) => expect(tierForScore(style, r.score).key).toBe("excellent"));
  });

  test("Helios sample (2 high, 4 medium, 4 low) → 56 / Fair", () => {
    // 2*12 + 4*4 + 4*1 = 24+16+4 = 44 → 56
    const r = computeHealthScore({ high: 2, medium: 4, low: 4 });
    expect(r.score).toBe(56);
    STYLES.forEach((style) => expect(tierForScore(style, r.score).key).toBe("fair"));
  });

  test("1 high alone → 88 / Strong (single high is meaningful but survivable)", () => {
    const r = computeHealthScore({ high: 1, medium: 0, low: 0 });
    expect(r.score).toBe(88);
    STYLES.forEach((style) => expect(tierForScore(style, r.score).key).toBe("strong"));
  });

  test("3 highs → 64 / Good (real diligence red flag)", () => {
    const r = computeHealthScore({ high: 3, medium: 0, low: 0 });
    expect(r.score).toBe(64);
    STYLES.forEach((style) => expect(tierForScore(style, r.score).key).toBe("good"));
  });

  test("5 highs → 40 / Weak (deal-affecting concentration)", () => {
    const r = computeHealthScore({ high: 5, medium: 0, low: 0 });
    expect(r.score).toBe(40);
    STYLES.forEach((style) => expect(tierForScore(style, r.score).key).toBe("weak"));
  });

  test("10 mediums alone → 60 / Good (was 70 under old scale)", () => {
    const r = computeHealthScore({ high: 0, medium: 10, low: 0 });
    expect(r.score).toBe(60);
    STYLES.forEach((style) => expect(tierForScore(style, r.score).key).toBe("good"));
  });

  test("20 lows alone → 80 / Strong (noise still hurts, but softly)", () => {
    const r = computeHealthScore({ high: 0, medium: 0, low: 20 });
    expect(r.score).toBe(80);
    STYLES.forEach((style) => expect(tierForScore(style, r.score).key).toBe("strong"));
  });

  test("catastrophic (10 high, 10 medium, 10 low) → clamped to 0 / Critical", () => {
    const r = computeHealthScore({ high: 10, medium: 10, low: 10 });
    expect(r.score).toBe(0);
    STYLES.forEach((style) => expect(tierForScore(style, r.score).key).toBe("critical"));
  });

  test("missing severity_breakdown → 100 / Excellent (fail-open)", () => {
    const r = computeHealthScore(undefined);
    expect(r.score).toBe(100);
    expect(r.total).toBe(0);
  });

  test("tier boundaries partition [0..100] cleanly, for every style", () => {
    // Every integer score should map to exactly one tier, per style.
    STYLES.forEach((style) => {
      const seen = new Set();
      for (let s = 0; s <= 100; s++) {
        const t = tierForScore(style, s);
        expect(t).toBeTruthy();
        seen.add(t.key);
      }
      expect(seen.size).toBe(7);
    });
  });
});
