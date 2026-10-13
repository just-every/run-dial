import { insist } from './sql.mjs';

const name = value => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const match = (item, tables, where) => {
  insist(tables.has(item.from), `unknown_from:${where}:${item.from}`);
  insist((item.on === undefined) !== (item.where === undefined), `edge_match:${where}`);
  if (item.on) insist(Object.keys(item.on).length > 0 && Object.entries(item.on).every(([a, b]) => name(a) && name(b)), `edge_columns:${where}`);
  if (item.where !== undefined) insist(text(item.where) && Array.isArray(item.params ?? []) && (item.params ?? []).every(name), `edge_predicate:${where}`);
};

/** Validates one entity's erasure graph. Policy hooks stay functions owned by the seed. */
export function defineErasure(input) {
  const d = { edges: [], redact: [], audit: [], retain: [], ...input };
  insist(typeof d.entity === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(d.entity), 'entity_name');
  insist(d.root && name(d.root.table), 'root_table');
  for (const key of ['edges', 'redact', 'audit', 'retain']) insist(Array.isArray(d[key]), `${key}_list`);
  // A table may be reached through several edges (cycles such as request <-> evidence).
  for (const [i, edge] of d.edges.entries()) insist(name(edge.table) && edge.table !== d.root.table, `edge_table:${i}`);
  const tables = new Set([d.root.table, ...d.edges.map(e => e.table)]);
  for (const [i, edge] of d.edges.entries()) {
    match(edge, tables, `edges[${i}]`);
    if (edge.blob) insist(name(edge.blob.bucket) && name(edge.blob.keyColumn), `edge_blob:${i}`);
  }
  for (const [i, item] of d.redact.entries()) {
    insist(name(item.table) && !tables.has(item.table), `redact_table:${i}`);
    match(item, tables, `redact[${i}]`);
    insist(item.set && Object.keys(item.set).length > 0 && Object.keys(item.set).every(name), `redact_set:${i}`);
    insist(text(item.reason), `redact_reason:${i}`);
  }
  for (const [i, item] of d.audit.entries()) {
    insist(name(item.table) && name(item.column) && tables.has(item.of), `audit:${i}`);
    insist(item.where === undefined || text(item.where), `audit_where:${i}`);
    insist(item.clear === undefined || Object.keys(item.clear).every(name), `audit_clear:${i}`);
  }
  for (const [i, item] of d.retain.entries()) insist(name(item.table) && !tables.has(item.table) && text(item.reason), `retain:${i}`);
  if (d.root.redact) {
    insist(text(d.root.redact.reason), 'root_redact_reason');
    insist(Array.isArray(d.root.redact.identityColumns ?? []) && (d.root.redact.identityColumns ?? []).every(name), 'root_identity_columns');
    insist(typeof d.root.redact.set === 'function' || (d.root.redact.set && Object.keys(d.root.redact.set).length > 0 && Object.keys(d.root.redact.set).every(name)), 'root_redact_set');
    // The retained root keeps its key, so rate writes naming it need a liveness
    // predicate the redaction ends (rateEdges root.live).
    for (const [i, edge] of d.edges.entries()) if (edge.rate && edge.from === d.root.table) insist(text(edge.rate.live), `rate_root_live:${i}`);
  }
  for (const hook of ['hold', 'beforeStatements', 'statements']) insist(d[hook] === undefined || typeof d[hook] === 'function', `${hook}_hook`);
  return Object.freeze({ ...d, tracked: [...tables], deleted: [...tables].filter(t => t !== d.root.table || !d.root.redact) });
}

export function buckets(declarations) {
  return [...new Set(declarations.flatMap(d => d.edges.filter(e => e.blob).map(e => e.blob.bucket)))];
}
