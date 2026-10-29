/** Called under Dial's exclusive native erasure admission, before native records
 * disappear. Audit policy evidence contains no tool arguments/results and stays
 * retained; payload custody and pending/replay authority do not survive erasure. */
export async function eraseAgentCustody(db: D1Database, subjects: readonly string[]) {
  const needles = [...new Set(subjects.flatMap(value => [value.toLowerCase(), encodeURIComponent(value).toLowerCase()]))].filter(Boolean);
  const matches = (value: string) => needles.some(needle => value.toLowerCase().includes(needle));
  const statements: D1PreparedStatement[] = [];
  const calls = await db.prepare("SELECT agent,key,outcome FROM agent_door_calls WHERE outcome IS NOT NULL").all<{agent: string; key: string; outcome: string}>();
  for (const row of calls.results) if (matches(row.outcome)) {
    const previous = JSON.parse(row.outcome) as {decision?: unknown};
    statements.push(db.prepare("UPDATE agent_door_calls SET outcome=? WHERE agent=? AND key=?")
      .bind(JSON.stringify({outcome: "refused", code: "resource_erased", decision: previous.decision ?? null}), row.agent, row.key));
  }
  for (const table of ["agent_door_approvals", "agent_door_reviews"] as const) {
    const rows = await db.prepare(`SELECT id,saved FROM ${table}`).all<{id: string; saved: string}>();
    for (const row of rows.results) if (matches(row.saved)) {
      const saved = JSON.parse(row.saved) as Record<string, unknown>;
      delete saved.args; delete saved.arguments; delete saved.result; delete saved.undo;
      saved.summary = {items: ["Client content removed by native person erasure"]};
      statements.push(db.prepare(`UPDATE ${table} SET state=?,saved=? WHERE id=?`)
        .bind(table === "agent_door_approvals" ? "expired" : "reviewed", JSON.stringify(saved), row.id));
      if (table === "agent_door_approvals") statements.push(db.prepare("UPDATE agent_door_approvals SET result=NULL,version=version+1 WHERE id=?").bind(row.id));
    }
  }
  const audits = await db.prepare("SELECT id,row FROM agent_door_audit").all<{id: string; row: string}>();
  for (const row of audits.results) {
    const audit = JSON.parse(row.row) as {resource?: unknown};
    if (audit.resource && matches(JSON.stringify(audit.resource))) {
      audit.resource = null;
      statements.push(db.prepare("UPDATE agent_door_audit SET row=? WHERE id=?").bind(JSON.stringify(audit), row.id));
    }
  }
  const events = await db.prepare("SELECT id,event FROM agent_door_events").all<{id: string; event: string}>();
  for (const row of events.results) if (matches(row.event)) statements.push(db.prepare("DELETE FROM agent_door_events WHERE id=?").bind(row.id));
  if (statements.length) await db.batch(statements);
}
