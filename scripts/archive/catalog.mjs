import { isInternalTable } from './policy.mjs';
export const quote = name => `"${name.replaceAll('"', '""')}"`;
export const tableQuery = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name";
export const catalogQuery = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table','index','trigger') ORDER BY type,name";
export function applicationCatalog(rows) { return rows.filter(row => !isInternalTable(row.tbl_name)).map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: row.sql })); }
