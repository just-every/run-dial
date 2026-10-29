import {
  ToolRefusal,
  type ToolContext,
  type NativeTarget,
} from "../../../base/modules/agent-door/index.ts";

export async function authorize(ctx: Pick<ToolContext, "db" | "person">) {
  const row = await ctx.db
    .prepare(
      `SELECT a.id FROM oa_operators a LEFT JOIN operators p ON p.id=a.id
    WHERE a.id=? AND a.status='active' AND a.role='owner' AND p.erased_at IS NULL`,
    )
    .bind(ctx.person.id)
    .first();
  if (!row) throw new ToolRefusal("role_forbidden");
}

/** Fence native batches against demotion/removal and stale record versions. */
export function effectDatabase(
  db: D1Database,
  ctx: ToolContext,
  tool: string,
  target: NativeTarget | null,
  revision?: {
    table: "event_types" | "host_profiles" | "availability_schedules";
    id: string;
    value: string;
  },
) {
  const mutations = new WeakSet<D1PreparedStatement>();
  const guards = () => [
    db
      .prepare(
        `SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators a LEFT JOIN operators p ON p.id=a.id
      WHERE a.id=? AND a.status='active' AND a.role='owner' AND p.erased_at IS NULL)
      THEN 1 ELSE abs(-9223372036854775808) END`,
      )
      .bind(ctx.person.id),
    ...(revision
      ? [
          db
            .prepare(
              `SELECT CASE WHEN EXISTS(SELECT 1 FROM ${revision.table} WHERE id=? AND updated_at=?) THEN 1 ELSE abs(-9223372036854775808) END`,
            )
            .bind(revision.id, revision.value),
        ]
      : []),
  ];
  const activity = () =>
    db
      .prepare(
        `INSERT OR IGNORE INTO agent_native_activity(operation_id,tool,target_kind,target_id,sponsor_id,agent_id,prepared_by,approvers,happened_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        ctx.operationId,
        tool,
        target?.kind ?? null,
        target?.id ?? null,
        ctx.person.id,
        ctx.agent.id,
        ctx.actor.label,
        JSON.stringify(ctx.approvers),
        new Date(ctx.now()).toISOString(),
      );
  const batch = async (statements: D1PreparedStatement[]) => {
    if (!statements.some((statement) => mutations.has(statement)))
      return db.batch(statements);
    const before = guards();
    const results = await db.batch([...before, ...statements, activity()]);
    return results.slice(before.length, before.length + statements.length);
  };
  return new Proxy(db, {
    get(database, key) {
      if (key === "batch") return batch;
      if (key === "prepare")
        return (sql: string) => {
          const wrap = (
            statement: D1PreparedStatement,
          ): D1PreparedStatement => {
            const mutation = !/^\s*(SELECT|PRAGMA)\b/i.test(sql);
            if (mutation) mutations.add(statement);
            const proxy = new Proxy(statement, {
              get(native, name) {
                if (name === "bind")
                  return (...values: unknown[]) => wrap(native.bind(...values));
                if (
                  ["run", "all", "first", "raw"].includes(String(name)) &&
                  !/^\s*(SELECT|PRAGMA)\b/i.test(sql)
                )
                  return async (column?: string) => {
                    const result = (await batch([native]))[0];
                    if (name === "raw")
                      return result.results.map((row) =>
                        Object.values(row as Record<string, unknown>),
                      );
                    return name === "first"
                      ? column
                        ? ((
                            result.results[0] as
                              | Record<string, unknown>
                              | undefined
                          )?.[column] ?? null)
                        : (result.results[0] ?? null)
                      : result;
                  };
                const value = Reflect.get(native, name);
                return typeof value === "function" ? value.bind(native) : value;
              },
            });
            if (mutation) mutations.add(proxy);
            return proxy;
          };
          return wrap(database.prepare(sql));
        };
      const value = Reflect.get(database, key);
      return typeof value === "function" ? value.bind(database) : value;
    },
  });
}
