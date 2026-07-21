// Maps AI diligence findings (severity_breakdown) to a 0-100 "company health"
// score, then renders that score as one of several visual metaphors. Each
// style shares the same score bands so switching styles never changes the
// underlying verdict, only how it's depicted.
//
// Iter-48: Scale rebalanced to be more critical. In real diligence, even a
// single unresolved high-severity finding is meaningful; the previous
// (8/3/0.75) curve was too forgiving — e.g. 4 highs still landed in "Fair".
// New (12/4/1) curve: 3 highs → "Good" (64), 5 highs → "Fair" (40),
// 10 mediums → "Good" (60), clean report (0/0/0) → "Excellent" (100).
const PENALTY = { high: 12, medium: 4, low: 1 };

export function computeHealthScore(severityBreakdown) {
  const sev = severityBreakdown || {};
  const high = Number(sev.high) || 0;
  const medium = Number(sev.medium) || 0;
  const low = Number(sev.low) || 0;
  const penalty = high * PENALTY.high + medium * PENALTY.medium + low * PENALTY.low;
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return { score, high, medium, low, total: high + medium + low };
}

const BANDS = [
  { key: "critical", min: 0, max: 14 },
  { key: "poor", min: 15, max: 29 },
  { key: "weak", min: 30, max: 44 },
  { key: "fair", min: 45, max: 59 },
  { key: "good", min: 60, max: 74 },
  { key: "strong", min: 75, max: 89 },
  { key: "excellent", min: 90, max: 100 },
];

export const VIZ_STYLES = {
  plant: {
    label: "Plant",
    tiers: [
      { ...BANDS[0], label: "Critical", blurb: "Multiple severe, unresolved risks are choking this deal.", image: "/health/plant/1_critical.jpg" },
      { ...BANDS[1], label: "Poor", blurb: "Significant risk concentration — this listing needs real work before it's investable.", image: "/health/plant/2_poor.jpg" },
      { ...BANDS[2], label: "Weak", blurb: "Meaningful gaps remain across several workstreams.", image: "/health/plant/3_weak.jpg" },
      { ...BANDS[3], label: "Fair", blurb: "Mixed picture — some risks flagged, nothing disqualifying on its own.", image: "/health/plant/4_fair.jpg" },
      { ...BANDS[4], label: "Good", blurb: "Solid fundamentals with only minor flags to track.", image: "/health/plant/5_good.jpg" },
      { ...BANDS[5], label: "Strong", blurb: "Clean diligence trail — few and low-severity findings.", image: "/health/plant/6_strong.jpg" },
      { ...BANDS[6], label: "Excellent", blurb: "Diligence surfaced little to no risk. As healthy as it gets.", image: "/health/plant/7_excellent.jpg" },
    ],
  },
  weather: {
    label: "Weather",
    tiers: [
      { ...BANDS[0], label: "Storm", blurb: "Multiple severe, unresolved risks are battering this deal.", image: "/health/weather/1_critical.jpg" },
      { ...BANDS[1], label: "Heavy rain", blurb: "Significant risk concentration — this listing needs real work before it's investable.", image: "/health/weather/2_poor.jpg" },
      { ...BANDS[2], label: "Overcast", blurb: "Meaningful gaps remain across several workstreams.", image: "/health/weather/3_weak.jpg" },
      { ...BANDS[3], label: "Partly cloudy", blurb: "Mixed picture — some risks flagged, nothing disqualifying on its own.", image: "/health/weather/4_fair.jpg" },
      { ...BANDS[4], label: "Mostly clear", blurb: "Solid fundamentals with only minor flags to track.", image: "/health/weather/5_good.jpg" },
      { ...BANDS[5], label: "Clear skies", blurb: "Clean diligence trail — few and low-severity findings.", image: "/health/weather/6_strong.jpg" },
      { ...BANDS[6], label: "Bright & clear", blurb: "Diligence surfaced little to no risk. As healthy as it gets.", image: "/health/weather/7_excellent.jpg" },
    ],
  },
};

export const DEFAULT_VIZ_STYLE = "plant";
export const VIZ_STYLE_STORAGE_KEY = "wz_health_viz_style";

export function tierForScore(style, score) {
  const tiers = (VIZ_STYLES[style] || VIZ_STYLES[DEFAULT_VIZ_STYLE]).tiers;
  return tiers.find((t) => score >= t.min && score <= t.max) || tiers[tiers.length - 1];
}
