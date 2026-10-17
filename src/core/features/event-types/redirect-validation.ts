import { z } from "zod";
import { redirectConfigIssue } from "./redirect-policy.mjs";

export const postBookingRedirectSchema = z.object({ url: z.string(), fields: z.array(z.string()) }).strict().nullable().optional();

export function validateEventRedirect(input: { postBookingRedirect?: { url: string; fields: string[] } | null; questions: { key?: string; private?: boolean }[] }, context: z.RefinementCtx) {
  const issue = redirectConfigIssue(input.postBookingRedirect, input.questions);
  if (issue) context.addIssue({ code: "custom", path: ["postBookingRedirect", ...issue.path], message: issue.message });
}
