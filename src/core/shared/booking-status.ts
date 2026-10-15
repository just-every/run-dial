/** Human-readable delivery facts shared by booking details and mail. */
export function calendarStatus(state: string) {
  switch (state) {
    case "not_required": return "No connected calendar";
    case "pending": return "Update pending";
    case "succeeded": return "Up to date";
    case "failed": return "Update failed";
    default: throw new Error("Unknown calendar delivery state");
  }
}

export function meetingStatus(state: string) {
  switch (state) {
    case "not_required": return "Use the provided location";
    case "pending": return "Meeting link pending";
    case "succeeded": return "Meeting link ready";
    case "failed": return "Meeting link unavailable";
    default: throw new Error("Unknown meeting delivery state");
  }
}
