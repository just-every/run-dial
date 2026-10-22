import { reportTileKeys, reportTileTitles, type ReportFigure, type ReportRow, type ReportTile, type ReportTileKey } from "./catalog";
import { definitions } from "./definitions";
import type { BookingFact } from "./facts";
import { hostWeekdayAndHour } from "./zoned";
import { attributionLabels, durationLabel, hourLabel, leadBuckets, reasonLabel, weekdayNames, weekdayOrder } from "./buckets";

export type ReportContext = { timezone: string; from: string; to: string; now: string };
const inside = (value: string | null, context: ReportContext) => value !== null && value >= context.from && value <= context.to;

/** Every tile and, for every tile and bucket, the exact bookings it counts: a drill-through lists `members`, so a
 * figure and the list behind it come from one classification. */
export function buildSchedulingReport(facts: BookingFact[], context: ReportContext) {
  const members = new Map<string, string[]>();
  const tile = new Map<ReportTileKey, { ids: Set<string>; imported: number }>(reportTileKeys.map(key => [key, { ids: new Set(), imported: 0 }]));
  const count = (key: ReportTileKey, fact: BookingFact, bucket?: string) => {
    const entry = tile.get(key)!;
    if (!entry.ids.has(fact.id)) { entry.ids.add(fact.id); if (fact.imported) entry.imported += 1; }
    if (!bucket) return;
    const name = `${key}|${bucket}`, list = members.get(name);
    if (list) list.push(fact.id); else members.set(name, [fact.id]);
  };
  const rows = new Map<string, Map<string, { label: string; count: number }>>();
  const row = (group: string, bucket: string, label: string, fact: BookingFact, key: ReportTileKey) => {
    const bucketRows = rows.get(group) ?? new Map();
    rows.set(group, bucketRows);
    const current = bucketRows.get(bucket) ?? { label, count: 0 };
    current.count += 1; bucketRows.set(bucket, current);
    count(key, fact, bucket);
  };
  const figures = new Map<ReportTileKey, ReportFigure[]>();
  let reschedules = 0, attended = 0, noShow = 0, unmarked = 0, untagged = 0, paymentCents = 0;
  const leads: number[] = [];
  for (const fact of facts) {
    if (inside(fact.createdAt, context)) {
      count("created", fact);
      count("source", fact); count("duration", fact);
      const minutes = (Date.parse(fact.endAt) - Date.parse(fact.startAt)) / 60_000;
      row("duration", `duration:${minutes}`, durationLabel(minutes), fact, "duration");
      const tags = Object.entries(fact.attribution);
      if (!tags.length) { untagged += 1; count("source", fact, "untagged"); }
      for (const [name, value] of tags) row(`source:${name}`, `${name}:${value}`, value, fact, "source");
      const lead = (Date.parse(fact.firstStartAt) - Date.parse(fact.createdAt)) / 3_600_000;
      if (lead >= 0) {
        leads.push(lead); count("lead_time", fact);
        const bucket = leadBuckets.find(([, , low, high]) => lead >= low && lead < high)!;
        row("lead_time", `lead:${bucket[0]}`, bucket[1], fact, "lead_time");
      }
    }
    const moves = fact.rescheduledAt.filter(at => inside(at, context)).length;
    if (moves) { reschedules += moves; count("rescheduled", fact, "any"); }
    if (fact.state === "cancelled" && inside(fact.cancelledAt, context)) row("cancelled", `reason:${fact.cancelledReason ?? ""}`, reasonLabel(fact.cancelledReason), fact, "cancelled");
    if (fact.state !== "cancelled" && inside(fact.startAt, context)) {
      const { weekday, hour } = hostWeekdayAndHour(fact.startAt, context.timezone);
      row("popular_days", `weekday:${weekday}`, weekdayNames[weekday], fact, "popular_days");
      row("popular_hours", `hour:${hour}`, hourLabel(hour), fact, "popular_hours");
      if (fact.endAt <= context.now) {
        if (fact.attendance === "attended") { attended += 1; row("attendance", "attended", "Attended", fact, "attendance"); }
        else if (fact.attendance === "no_show") { noShow += 1; row("attendance", "no_show", "No-show", fact, "attendance"); }
        else { unmarked += 1; row("attendance", "unmarked", "Not marked", fact, "attendance"); }
      }
    }
    if (inside(fact.paidAt, context)) { paymentCents += fact.paidCents; count("revenue", fact); }
  }
  const marked = attended + noShow;
  const percent = (part: number) => marked ? Math.round(part / marked * 1000) / 10 : null;
  const sorted = [...leads].sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
  figures.set("rescheduled", [{ key: "reschedules", label: "Reschedules in the period", value: reschedules, unit: "bookings" }]);
  figures.set("attendance", [
    { key: "attended", label: "Attended", value: attended, unit: "bookings" }, { key: "no_show", label: "No-show", value: noShow, unit: "bookings" }, { key: "unmarked", label: "Not marked", value: unmarked, unit: "bookings" },
    { key: "attendance_rate", label: "Attendance rate", value: percent(attended), unit: "percent" }, { key: "no_show_rate", label: "No-show rate", value: percent(noShow), unit: "percent" }]);
  figures.set("lead_time", [{ key: "average_hours", label: "Average lead time", value: leads.length ? Math.round(leads.reduce((sum, value) => sum + value, 0) / leads.length * 10) / 10 : null, unit: "hours" }, { key: "median_hours", label: "Median lead time", value: median === null ? null : Math.round(median * 10) / 10, unit: "hours" }]);
  figures.set("source", [{ key: "untagged", label: "Arrived with no UTM or source", value: untagged, unit: "bookings" }]);
  figures.set("revenue", [{ key: "revenue", label: "Revenue", value: paymentCents, unit: "usd_cents" }]);
  const group = (title: string, name: string, order?: (rows: ReportRow[]) => ReportRow[]) => {
    const list = [...(rows.get(name) ?? new Map()).entries()].map(([bucket, value]): ReportRow => ({ label: value.label, count: value.count, bucket }));
    return list.length ? [{ title, rows: order ? order(list) : list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)) }] : [];
  };
  const groups: Record<ReportTileKey, Array<{ title: string; rows: ReportRow[] }>> = {
    created: [], rescheduled: [], revenue: [],
    cancelled: group("Reasons", "cancelled"),
    attendance: group("Outcomes", "attendance", list => ["attended", "no_show", "unmarked"].flatMap(bucket => list.filter(entry => entry.bucket === bucket))),
    lead_time: group("Lead time", "lead_time", list => leadBuckets.flatMap(([key]) => list.filter(entry => entry.bucket === `lead:${key}`))),
    popular_days: group("Weekday", "popular_days", list => weekdayOrder.flatMap(day => list.filter(entry => entry.bucket === `weekday:${day}`))),
    popular_hours: group("Starting hour", "popular_hours", list => list.sort((a, b) => Number(a.bucket.slice(5)) - Number(b.bucket.slice(5)))),
    source: Object.keys(attributionLabels).flatMap(name => group(attributionLabels[name], `source:${name}`)),
    duration: group("Length", "duration", list => list.sort((a, b) => Number(a.bucket.slice(9)) - Number(b.bucket.slice(9)))),
  };
  for (const [key, entry] of tile) members.set(key, [...entry.ids]);
  const tiles: ReportTile[] = reportTileKeys.map(key => ({ key, title: reportTileTitles[key], definition: definitions[key], count: tile.get(key)!.ids.size, imported: tile.get(key)!.imported, figures: figures.get(key) ?? [], groups: groups[key] }));
  return { tiles, members };
}
