import { z } from "zod";

const publicDeploymentConfigSchema = z.object({
  /** Who runs this deployment, named in the public footer; omitted until the owner names one. */
  owner: z.object({ name: z.string().min(1) }).optional(),
  description: z.string().min(1).max(180),
  privacyNoticeUrl: z.union([z.string().regex(/^\/[^\s]*$/), z.string().url()]),
  theme: z.object({ primary: z.string().min(1), accent: z.string().min(1), radius: z.string().min(1) }),
  showPoweredBy: z.boolean(),
});

export const deploymentConfigSchema = z.object({
  operatorEmail: z.string().email().optional(),
});

export { publicDeploymentConfigSchema };
export type DeploymentConfig = z.infer<typeof deploymentConfigSchema>;
export type PublicDeploymentConfig = z.infer<typeof publicDeploymentConfigSchema>;
