import type { BookingExportRow } from "../bookings";

const columns = ["bookingId", "eventTypeId", "eventTitle", "state", "inviteeName", "inviteeEmail", "hostTimezone", "inviteeTimezone", "startAt", "endAt", "durationMinutes", "createdAt"] as const satisfies readonly (keyof BookingExportRow)[];

function cell(value: string | number | null) {
  const text = String(value ?? "");
  // Quoting alone does not stop spreadsheets from executing an invitee's formula.
  const literal = /^[\t\r]|^\s*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${literal.replaceAll('"', '""')}"`;
}

/** UTF-8 CSV with CRLF records and explicit columns; object keys never define the export. */
export function bookingCsv(rows: BookingExportRow[]) {
  return [columns.map(cell).join(","), ...rows.map(row => columns.map(column => cell(row[column])).join(","))].join("\r\n") + "\r\n";
}
