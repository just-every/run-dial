import { publicDeploymentConfig } from "./ext/public-config";
import { siteIdentity } from "./site/identity";
export const identity = { ...siteIdentity, deployment: publicDeploymentConfig.owner?.name ?? siteIdentity.product };
