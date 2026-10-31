/** Plain addresses for the Bookings views. */
const bookingViews: Record<string, string> = { "/app/clients": "clients", "/app/polls": "polls", "/app/calendar": "calendar", "/app/reports": "report" };

/** GET or HEAD of a plain Bookings view address answers a redirect to that view; anything else is null. */
export function plainAddressRedirect(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const view = bookingViews[new URL(request.url).pathname.replace(/\/$/, "")];
  return view ? new Response(null, { status: 302, headers: { "cache-control": "no-store", location: `/app/bookings?view=${view}` } }) : null;
}
