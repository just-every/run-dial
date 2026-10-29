import type { Context } from "hono";

export function apiError(context: Context, status: 422 | 413 | 415 | 400 | 403 | 401 | 404 | 409 | 410 | 429 | 503, code: string, message: string, details?: string[]) {
  return context.json({ error: { code, message, ...(details ? { details } : {}) } }, status);
}

/** Consume and drop what is left of a refused request body. The runtime's request stream must finish before an early answer is sent, or the connection can reset or the runtime can fail the response. */
export async function discardRequestBody(request: Request): Promise<void> {
  if (!request.body) return;
  const reader = request.body.getReader();
  try { while (!(await reader.read()).done); } finally { reader.releaseLock(); }
}

/** Provider callbacks are verified before public admission, so their bodies are kept only up to Base delivery-event intake's 1 MiB. */
export const providerCallbackMaxBytes = 1024 * 1024;

/** Read the whole body up to the limit by counting streamed bytes. Over the limit it discards the remainder and returns undefined. */
export async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array | undefined> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { chunks.length = 0; while (!(await reader.read()).done); return undefined; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function providerCallbackTooLarge(context: Context) {
  return apiError(context, 413, "provider_callback_too_large", "Provider callback bodies are limited to 1 MiB.");
}
