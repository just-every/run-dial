import { pageLoadTransport } from "./page-load-transport";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const loadDocument = createServerFn({ method: "GET" }).middleware([pageLoadTransport])
  .inputValidator(z.object({ path: z.string().max(2048) }))
  .handler(async ({ data }) => {
    const { readPublicDocument } = await import("./documents.server");
    return { ...await readPublicDocument(data.path), renderInstant: new Date().toISOString() };
  });

export const loadPrivateShell = createServerFn({ method: "GET" }).middleware([pageLoadTransport]).inputValidator(z.object({ path: z.string().max(2048) })).handler(async ({ data }) => {
  const { readPrivateShell } = await import("./documents.server");
  return readPrivateShell(false, data.path);
});

// Only public sign-in presentation leaves this server function. Bootstrap retains
// its independent transactional first-owner guard.
export const loadSigninOptions = createServerFn({ method: "GET" }).middleware([pageLoadTransport])
  .inputValidator(z.object({ loginHint: z.string().optional() }))
  .handler(async ({ data }) => {
    const { readSigninOptions } = await import("./signin-options.server");
    return readSigninOptions(data.loginHint);
  });

export const loadSetupShell = createServerFn({ method: "GET" }).middleware([pageLoadTransport]).handler(async () => {
  const { readPrivateShell } = await import("./documents.server");
  return readPrivateShell(true);
});
