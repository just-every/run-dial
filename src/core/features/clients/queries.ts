export const clientPageSize = 50;
export function clientPage(value: string | null) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 20_001 ? page : 1;
}
export const clientListPath = (page: number) => "/api/app/clients?" + new URLSearchParams({ limit: String(clientPageSize), offset: String((page - 1) * clientPageSize) });
export const clientHistoryPath = (email: string, page: number) => "/api/app/clients/history?" + new URLSearchParams({ email, limit: String(clientPageSize), offset: String((page - 1) * clientPageSize) });
