import { hc } from "hono/client";
import { z } from "zod";
import type { AppType } from "../app/hono";

/** The browser talks only through the Worker contract declared by AppType. */
export const api = hc<AppType>("/", {
  init: { credentials: "same-origin" },
});

/** Public requests need the hosted demo's visitor cookie to reach its isolated app. */
export const publicApi = hc<AppType>("/", {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, {
    ...init,
    credentials: typeof document !== "undefined" && document.querySelector('style[data-rer-label="Demo"]') ? "same-origin" : "omit",
  }),
});

const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.array(z.string()).optional() }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export async function errorMessage(response: { json(): Promise<unknown> }) {
  const result = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
  return result.success ? result.data.error.message : "The request could not be completed.";
}
