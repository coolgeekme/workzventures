/**
 * Display names for stored role ids.
 *
 * The ids themselves ("agent", "buyer", …) are the data model and are NOT
 * renamed — this map exists so the UI never shows a raw role string, and so
 * "agent" reads as "Advisor" to users. The word "Agent" is reserved for the
 * platform's automated jobs (see the Automation Monitor page).
 */
export const ROLE_LABELS = {
  admin: "Admin",
  buyer: "Buyer",
  seller: "Seller",
  agent: "Advisor",
};

/** Longer form, for pickers and invite copy. */
export const ROLE_LABELS_LONG = {
  admin: "Admin",
  buyer: "Buyer · acquire companies",
  seller: "Seller · market portfolio",
  agent: "Advisor · broker / advisor (both sides)",
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || "";
}
