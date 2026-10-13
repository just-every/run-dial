export function operatorTimestamp(value: string, timezone = "UTC") {
  return `${new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value))} (${timezone})`;
}
