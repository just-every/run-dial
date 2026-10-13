/**
 * Buyer-owned browser-safe configuration. This is the source of public identity,
 * theme, and privacy settings; the booking link is derived from the persisted profile.
 */
import { publicDeploymentConfigSchema } from "../core/shared/config";

export const publicDeploymentConfig = publicDeploymentConfigSchema.parse({
  description: "Scheduling you run yourself.",
  privacyNoticeUrl: "/privacy",
  theme: { primary: "#1d1c1a", accent: "#f4f1ea", radius: "999px" },
  showPoweredBy: true,
});
