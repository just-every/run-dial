/** Plain addresses for the Bookings views, and the front door for an open session. */
const bookingViews: Record<string, string> = { "/app/calendar": "calendar", "/app/reports": "report" };
const headers = { "cache-control": "no-store" };

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { ...headers, location } });
}

function withPage(path: string, entries: Array<[string, string | null]>) {
  const search = new URLSearchParams();
  for (const [key, value] of entries) if (value && /^[1-9]\d{0,4}$/.test(value) && value !== "1") search.set(key, value);
  return search.size ? `${path}?${search}` : path;
}

/** Clients and meeting polls were Bookings views; each now has its own home, and a record its own path (DW6). */
function movedViewAddress(url: URL) {
  if (url.pathname.replace(/\/$/, "") !== "/app/bookings") return null;
  const view = url.searchParams.get("view"), client = url.searchParams.get("client"), record = url.searchParams.get("record");
  if (view === "polls") return "/app/polls";
  if (view !== "clients") return null;
  if (record) return `/app/bookings/${encodeURIComponent(record)}${client ? `?${new URLSearchParams({ query: client, client })}` : ""}`;
  if (client) return withPage(`/app/clients/${encodeURIComponent(client)}`, [["clientPage", url.searchParams.get("clientPage")], ["historyPage", url.searchParams.get("historyPage")]]);
  return withPage("/app/clients", [["clientPage", url.searchParams.get("clientPage")]]);
}

/** GET or HEAD of a plain Bookings view address, or of a view that moved to its own path, answers one redirect; anything else is null. */
export function plainAddressRedirect(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const view = bookingViews[url.pathname.replace(/\/$/, "")];
  if (view) return redirect(`/app/bookings?view=${view}`);
  const moved = movedViewAddress(url);
  return moved ? redirect(moved) : null;
}

/** An open session never meets the sign-in front door at /: it goes to the workspace. */
export async function openSessionHome(request: Request, hasSession: () => Promise<unknown>): Promise<Response | null> {
  if ((request.method !== "GET" && request.method !== "HEAD") || new URL(request.url).pathname !== "/" || !request.headers.has("cookie")) return null;
  return await hasSession() ? redirect("/app") : null;
}
