export const clientPageSize = 50;
export function clientPage(value: string | null) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 20_001 ? page : 1;
}
export const clientListPath = (page: number) => "/api/app/clients?" + new URLSearchParams({ limit: String(clientPageSize), offset: String((page - 1) * clientPageSize) });
export const clientHistoryPath = (email: string, page: number) => "/api/app/clients/history?" + new URLSearchParams({ email, limit: String(clientPageSize), offset: String((page - 1) * clientPageSize) });
/** A client's name alone: the history's first entry carries it, so the read stays one booking long. */
export const clientNamePath = (email: string) => "/api/app/clients/history?" + new URLSearchParams({ email, limit: "1", offset: "0" });
/** A client's address as the path carries it: one email of at most 320 characters. */
export function clientAddress(value: string | undefined) {
  const email = value?.trim();
  return email && email.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : undefined;
}
