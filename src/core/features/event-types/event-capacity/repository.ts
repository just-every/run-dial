import { getTableColumns, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/** Only inserts are conditional: existing records remain editable and portable. */
export function guardedCreationInsert(
  binding: D1Database,
  table: SQLiteTable,
  values: Record<string, string | number | boolean | null>,
  guard: string,
  params: (string | number)[],
) {
  const columns = getTableColumns(table), entries = Object.entries(values);
  return binding.prepare(`INSERT INTO "${getTableName(table)}" (${entries.map(([key]) => `"${columns[key].name}"`).join(",")})
    SELECT ${entries.map(() => "?").join(",")} WHERE ${guard}`)
    .bind(...entries.map(([, value]) => typeof value === "boolean" ? Number(value) : value), ...params);
}
