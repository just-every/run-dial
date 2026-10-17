import { appendLinkContext } from "./link-context";

/** Embedded navigation retains the explicitly supplied parent without reading browser state during SSR. */
export function bookingPath(handle: string, slug: string, suffix: "" | "/details" | "/confirmed" | "/request", embedded: boolean, params: Record<string, string> = {}, currentSearch = "") {
  const search = new URLSearchParams(params);
  const current = new URLSearchParams(currentSearch);
  if (suffix !== "/confirmed") {
    appendLinkContext(search, currentSearch);
    for (const key of ["week", "day", "timezone"]) {
      const value = current.get(key);
      if (value && !search.has(key)) search.set(key, value);
    }
  }
  if (embedded) {
    const parent = current.get("parent") ?? "";
    search.set("parent", parent);
    return `/embed/${handle}/${slug}${suffix}?${search.toString()}#dial-parent=${encodeURIComponent(parent)}`;
  }
  const query = search.toString();
  return `/book/${handle}/${slug}${suffix}${query ? `?${query}` : ""}`;
}

export function manageToken(url: string) {
  try { return new URL(url, "https://dial.invalid").pathname.split("/").at(-1) || undefined; }
  catch { return undefined; }
}

export function embedManageUrl(url: string, currentSearch: string) {
  const token = manageToken(url);
  const parent = new URLSearchParams(currentSearch).get("parent") ?? "";
  return token ? `/embed/manage/${encodeURIComponent(token)}?parent=${encodeURIComponent(parent)}#dial-parent=${encodeURIComponent(parent)}` : "/";
}
