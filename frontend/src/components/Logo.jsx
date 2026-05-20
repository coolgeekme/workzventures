/**
 * Workz Ventures official logo (lion + wordmark, on black).
 * Use this everywhere the brand mark appears.
 */
import React from "react";

export const WORKZ_LOGO_URL =
  "https://customer-assets.emergentagent.com/job_buyer-intel-lab/artifacts/i0ow1afe_1afded40fcf1a65f8138e69b1191c0b8.png";

// Hero key visual — lion + wordmark + tagline on skyscraper backdrop
export const WORKZ_HERO_URL =
  "https://customer-assets.emergentagent.com/job_buyer-intel-lab/artifacts/mtl2u4cl_eb9c42c75e492db9ec952105c8ad0f0d.png";

const SIZES = {
  xs: 24,
  sm: 32,
  md: 44,
  lg: 64,
  xl: 96,
  "2xl": 140,
};

export default function Logo({
  size = "sm",
  className = "",
  square = true,
  testid = "wz-logo",
}) {
  const px = SIZES[size] ?? SIZES.sm;
  return (
    <img
      src={WORKZ_LOGO_URL}
      alt="Workz Ventures"
      width={px}
      height={square ? px : undefined}
      data-testid={testid}
      className={`select-none object-contain ${className}`}
      style={{ width: px, height: square ? px : "auto" }}
      draggable={false}
    />
  );
}
