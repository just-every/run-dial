import { hc } from "hono/client";
import { z } from "zod";
import type { AppType } from "../app/hono";

/** The browser talks only through the Worker contract declared by AppType. */
export const api = hc<AppType>("/", {
  init: { credentials: "same-origin" },
});

/** Sessionless public reads deliberately omit operator cookies. */
export const publicApi = hc<AppType>("/", {
  init: { credentials: "omit" },
});

const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.array(z.string()).optional() }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export async function errorMessage(response: { json(): Promise<unknown> }) {
  const result = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
  return result.success ? result.data.error.message : "The request could not be completed.";
}
