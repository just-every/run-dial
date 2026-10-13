import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const loadDocument = createServerFn({ method: "GET" })
  .inputValidator(z.object({ path: z.string().max(2048) }))
  .handler(async ({ data }) => {
    const { readPublicDocument } = await import("./documents.server");
    return { ...await readPublicDocument(data.path), renderInstant: new Date().toISOString() };
  });

export const loadPrivateShell = createServerFn({ method: "GET" }).handler(async () => {
  const { readPrivateShell } = await import("./documents.server");
  return readPrivateShell();
});

// Only public presentation flags leave this server function. Bootstrap retains
// its independent transactional first-owner guard.
export const loadSigninOptions = createServerFn({ method: "GET" }).handler(async () => {
  const { readSigninOptions } = await import("./signin-options.server");
  return readSigninOptions();
});

export const loadSetupShell = createServerFn({ method: "GET" }).handler(async () => {
  const { readPrivateShell } = await import("./documents.server");
  return readPrivateShell(true);
});
