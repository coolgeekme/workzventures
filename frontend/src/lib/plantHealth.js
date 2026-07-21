// Maps AI diligence findings (severity_breakdown) to a 0-100 "company health"
// score and a visual plant tier. Each finding subtracts a fixed penalty by
// severity; the remainder is how healthy the plant looks.
const PENALTY = { high: 8, medium: 3, low: 0.75 };

export const PLANT_TIERS = [
  { key: "critical", min: 0, max: 14, label: "Critical", blurb: "Multiple severe, unresolved risks are choking this deal.", image: "/health/1_critical.jpg" },
  { key: "poor", min: 15, max: 29, label: "Poor", blurb: "Significant risk concentration — this listing needs real work before it's investable.", image: "/health/2_poor.jpg" },
  { key: "weak", min: 30, max: 44, label: "Weak", blurb: "Meaningful gaps remain across several workstreams.", image: "/health/3_weak.jpg" },
  { key: "fair", min: 45, max: 59, label: "Fair", blurb: "Mixed picture — some risks flagged, nothing disqualifying on its own.", image: "/health/4_fair.jpg" },
  { key: "good", min: 60, max: 74, label: "Good", blurb: "Solid fundamentals with only minor flags to track.", image: "/health/5_good.jpg" },
  { key: "strong", min: 75, max: 89, label: "Strong", blurb: "Clean diligence trail — few and low-severity findings.", image: "/health/6_strong.jpg" },
  { key: "excellent", min: 90, max: 100, label: "Excellent", blurb: "Diligence surfaced little to no risk. As healthy as it gets.", image: "/health/7_excellent.jpg" },
];

export function computeHealthScore(severityBreakdown) {
  const sev = severityBreakdown || {};
  const high = Number(sev.high) || 0;
  const medium = Number(sev.medium) || 0;
  const low = Number(sev.low) || 0;
  const penalty = high * PENALTY.high + medium * PENALTY.medium + low * PENALTY.low;
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return { score, high, medium, low, total: high + medium + low };
}

export function tierForScore(score) {
  return PLANT_TIERS.find((t) => score >= t.min && score <= t.max) || PLANT_TIERS[PLANT_TIERS.length - 1];
}
