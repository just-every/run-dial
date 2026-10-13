// Base's checkpoint operations use only D1, without snapshot policy or buckets.
declare module "*scripts/base-cli/modules/portability/export.mjs" {
 interface ExportStatus {
  id: string;
  kind: "export";
  phase: string;
  completed: number;
  total: number | null;
  contentHash: string | null;
 }
 export function exportStatus(context: { db: D1Database }, id: string): Promise<ExportStatus>;
 export function abortExport(context: { db: D1Database }, id: string): Promise<ExportStatus>;
}
