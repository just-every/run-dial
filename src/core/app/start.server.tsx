import { createStartHandler, defaultStreamHandler, StartServer } from "@tanstack/react-start/server";
import { createSsrStreamResponse, defineHandlerCallback, transformReadableStreamWithRouter } from "@tanstack/react-router/ssr/server";
import { renderToReadableStream } from "react-dom/server";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export default {
  fetch: createStartHandler(defineHandlerCallback(async options => {
    const { request, router, responseHeaders } = options;
    // Private pages have already authenticated. Crawlers cannot index them;
    // waiting for every Suspense boundary only delays their public asset links.
    if (!/^\/app(\/|$)/.test(new URL(request.url).pathname)) return defaultStreamHandler(options);
    const stream = await renderToReadableStream(<StartServer router={router} />, {
      signal: request.signal,
      nonce: router.options.ssr?.nonce,
      progressiveChunkSize: Number.POSITIVE_INFINITY,
      onError(error) {
        if (!request.signal.aborted && !(error instanceof Error && error.name === "AbortError")) console.error("private_document_render_failed", error);
      },
    });
    const body = transformReadableStreamWithRouter(router, stream as unknown as NodeReadableStream, {
      signal: request.signal,
      onAbort: () => stream.cancel().catch(() => {}),
    });
    return createSsrStreamResponse(router, new Response(body, {
      status: router._serverResult?.type === "render" ? router._serverResult.status : 200,
      headers: responseHeaders,
    }));
  })),
};
