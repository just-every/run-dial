import type { Context } from "hono";

export function apiError(context: Context, status: 413 | 415 | 400 | 403 | 401 | 404 | 409 | 410 | 429 | 503, code: string, message: string, details?: string[]) {
  return context.json({ error: { code, message, ...(details ? { details } : {}) } }, status);
}

/** Consume and drop what is left of a refused request body. The runtime's request stream must finish before an early answer is sent, or the connection can reset or the runtime can fail the response. */
export async function discardRequestBody(request: Request): Promise<void> {
  if (!request.body) return;
  const reader = request.body.getReader();
  try { while (!(await reader.read()).done); } finally { reader.releaseLock(); }
}
