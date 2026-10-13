import { createContext } from "react";
import type { PublicDeploymentConfig } from "../../../shared/config";
export type SiteVariant = "installed" | "site";
export const SiteVariantContext = createContext<SiteVariant>("installed");
export const SiteDeploymentContext = createContext<Pick<PublicDeploymentConfig, "owner" | "description" | "showPoweredBy">>({
  description: "Scheduling you run yourself.", showPoweredBy: true,
});
