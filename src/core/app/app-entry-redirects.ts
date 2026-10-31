/** Plain addresses for the Bookings views, and the front door for an open session. */
const bookingViews: Record<string, string> = { "/app/clients": "clients", "/app/polls": "polls", "/app/calendar": "calendar", "/app/reports": "report" };
const headers = { "cache-control": "no-store" };

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { ...headers, location } });
}

/** GET or HEAD of a plain Bookings view address answers a redirect to that view; anything else is null. */
export function plainAddressRedirect(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const view = bookingViews[new URL(request.url).pathname.replace(/\/$/, "")];
  return view ? redirect(`/app/bookings?view=${view}`) : null;
}

/** An open session never meets the sign-in front door at /: it goes to the workspace. */
export async function openSessionHome(request: Request, hasSession: () => Promise<unknown>): Promise<Response | null> {
  if ((request.method !== "GET" && request.method !== "HEAD") || new URL(request.url).pathname !== "/" || !request.headers.has("cookie")) return null;
  return await hasSession() ? redirect("/app") : null;
}
