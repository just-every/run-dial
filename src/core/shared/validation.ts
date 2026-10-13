import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { z } from "zod";
import { apiError } from "./http";

type ValidationTarget = "json" | "param" | "query";

/** Converts every trust-boundary validation failure to the shared API envelope. */
export function validate<T extends z.ZodType, Target extends ValidationTarget>(target: Target, schema: T) {
  return zValidator(target, schema, (result, context: Context) => {
    if (result.success) return;
    const fields = result.error.issues.map((issue) => issue.path.join(".") || target);
    return apiError(context, 400, "invalid_request", "The request contains invalid fields.", fields);
  });
}
