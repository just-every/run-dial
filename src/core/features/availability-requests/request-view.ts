export type RequestView = "all" | "submitted" | "handled" | "closed";

/** Requests' View lives in the search string as ?state=; Submitted is the default and is left out of the address. */
export function readRequestView(search: URLSearchParams): RequestView {
  const state = search.get("state");
  return state === "all" || state === "handled" || state === "closed" ? state : "submitted";
}

export function requestListPath(view: RequestView) {
  return "/api/app/availability-requests" + (view === "all" ? "" : `?state=${view}`);
}

export function requestListAddress(view: RequestView) {
  return "/app/requests" + (view === "submitted" ? "" : `?state=${view}`);
}
