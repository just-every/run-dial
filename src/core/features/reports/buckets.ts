/** REPORT-001 breakdown rows: one bucket key per row, and the label the report and its drill-through both show. */
export const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
export const attributionLabels: Record<string, string> = { utm_source: "UTM source", utm_medium: "UTM medium", utm_campaign: "UTM campaign", utm_term: "UTM term", utm_content: "UTM content", source: "Source" };
export const leadBuckets = [["lt1d", "Under 1 day", 0, 24], ["1to3d", "1 to under 3 days", 24, 72], ["3to7d", "3 to under 7 days", 72, 168], ["ge7d", "7 days or more", 168, Infinity]] as const;
const outcomes: Record<string, string> = { attended: "Attended", no_show: "No-show", unmarked: "Not marked", untagged: "No UTM or source", any: "" };

export const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
export const durationLabel = (minutes: number) => `${minutes} minutes`;
export const reasonLabel = (reason: string | null) => reason || "No reason given";

/** The label of a bucket key such as `weekday:2`, `reason:Plans changed` or `utm_source:newsletter`. */
export function bucketLabel(bucket: string) {
  if (Object.hasOwn(outcomes, bucket)) return outcomes[bucket];
  const split = bucket.indexOf(":"), kind = bucket.slice(0, split), value = bucket.slice(split + 1);
  if (kind === "weekday") return weekdayNames[Number(value)] ?? value;
  if (kind === "hour") return hourLabel(Number(value));
  if (kind === "duration") return durationLabel(Number(value));
  if (kind === "lead") return leadBuckets.find(([key]) => key === value)?.[1] ?? value;
  if (kind === "reason") return reasonLabel(value);
  if (Object.hasOwn(attributionLabels, kind)) return `${attributionLabels[kind]}: ${value}`;
  return bucket;
}
