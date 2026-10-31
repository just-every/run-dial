/** REPORT-001 vocabulary shared by the Worker and the browser: tile keys and titles, and the report's JSON shape. */
export const reportTileKeys = ["created", "rescheduled", "cancelled", "attendance", "lead_time", "popular_days", "popular_hours", "source", "duration", "revenue"] as const;
export type ReportTileKey = typeof reportTileKeys[number];

export const reportTileTitles: Record<ReportTileKey, string> = {
  created: "Bookings created",
  rescheduled: "Bookings rescheduled",
  cancelled: "Bookings cancelled",
  attendance: "Attendance and no-shows",
  lead_time: "Lead time",
  popular_days: "Popular days",
  popular_hours: "Popular hours",
  source: "Bookings by UTM and source",
  duration: "Bookings by duration",
  revenue: "Revenue, refunds and fees",
};

export type ReportRow = { label: string; count: number; bucket: string };
export type ReportFigure = { key: string; label: string; value: number | null; unit: "bookings" | "percent" | "hours" | "usd_cents" };
export type ReportTile = {
  key: ReportTileKey; title: string; definition: string;
  /** The bookings the tile counts, and how many of them were imported (counted by their source creation time and start). */
  count: number; imported: number;
  figures: ReportFigure[]; groups: Array<{ title: string; rows: ReportRow[] }>;
};
export type SchedulingReport = { period: { fromDate: string; throughDate: string; timezone: string }; eventTypeId: string | null; tiles: ReportTile[] };
