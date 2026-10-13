/** Server configuration comes from installation inputs, never a sample identity. */
import { deploymentConfigSchema } from "../core/shared/config";
export const deploymentConfig = deploymentConfigSchema.parse({});
