import { createMiddleware } from "@tanstack/react-start";

/** Start otherwise accepts an admission JSON refusal as successful loader data. */
export const pageLoadTransport = createMiddleware({ type: "function" }).client(({ next }) => next({
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 429) throw loadRefusal();
    if (response.status === 503) {
      const payload = await response.clone().json().catch(() => undefined) as { error?: { code?: string } } | undefined;
      if (["rate_limit_state_unavailable", "client_identity_unavailable"].includes(payload?.error?.code ?? "")) throw loadRefusal();
    }
    return response;
  },
}));

function loadRefusal() {
  const error = new Error("The page load was refused by public admission.");
  error.name = "PageLoadRefusal";
  return error;
}
