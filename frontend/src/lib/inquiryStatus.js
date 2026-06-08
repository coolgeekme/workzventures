// Inquiry status display labels.
// DB values stay the same — these are user-facing labels.
// `engaged` is M&A slang for "we'll proceed" and `passed` is "declined".
// We surface clearer English so non-M&A users don't misinterpret them.

export const INQUIRY_STATUS_LABEL = {
  new: "New",
  reviewing: "Reviewing",
  engaged: "Accepted",
  passed: "Declined",
};

export const INQUIRY_STATUS_DESCRIPTION = {
  new: "Unread by the seller.",
  reviewing: "Seller is reviewing your inquiry.",
  engaged: "Seller has accepted — Vault can now be opened.",
  passed: "Seller declined this inquiry. No Vault will be opened.",
};

// Triage button copy (seller view) — describes what the *next* state means.
export const INQUIRY_TRIAGE_LABEL = {
  new: "Mark as New",
  reviewing: "Move to Reviewing",
  engaged: "Accept (open Vault next)",
  passed: "Decline",
};

export const INQUIRY_TRIAGE_CONFIRM = {
  passed: "Decline this inquiry?\n\nThe buyer will NOT get access to the Vault for this listing. They will be notified that you passed.",
};

export const inquiryStatusLabel = (s) => INQUIRY_STATUS_LABEL[s] || s;
