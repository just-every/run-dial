import type { ErasureAuditEntry } from "./query";

const columns = ["id", "actorType", "actorId", "happenedAt", "action", "subjectKind"] as const;
const cell = (value: string | null) => `"${(value ?? "").replace(/^[=+@\-\t\r]/u, "'$&").replaceAll('"', '""')}"`;
const line = (values: Array<string | null>) => values.map(cell).join(",") + "\r\n";

/** Stream the explicit safe projection; newly stored columns never join CSV. */
export function erasureAuditCsv(entries: AsyncIterable<ErasureAuditEntry>) {
  const encoder = new TextEncoder();
  const iterator = entries[Symbol.asyncIterator]();
  let header = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (header) {
        header = false;
        controller.enqueue(encoder.encode(line([...columns])));
        return;
      }
      const next = await iterator.next();
      if (next.done) { controller.close(); return; }
      controller.enqueue(encoder.encode(line(columns.map(column => next.value[column]))));
    },
    async cancel() { await iterator.return?.(); },
  });
}
