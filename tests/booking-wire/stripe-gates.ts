/** Explicit HTTP-edge barriers for deterministic payment/cancellation interleavings. */
export async function stripeGate(db: D1Database, path: string, method: string) {
  const row = await db.prepare("SELECT name FROM wire_stripe_gates WHERE path=? AND method=? AND entered=0 AND released=0 LIMIT 1").bind(path, method).first<{ name: string }>();
  if (!row) return;
  await db.prepare("UPDATE wire_stripe_gates SET entered=1 WHERE name=?").bind(row.name).run();
  await waitFor(db, row.name, "released");
}

export async function stripeGateFixture(db: D1Database, request: Request) {
  const input = await request.json<{ action: "arm" | "entered" | "release"; name: string; path?: string; method?: string }>();
  if (input.action === "arm") await db.prepare("INSERT INTO wire_stripe_gates(name,path,method,entered,released) VALUES(?,?,?,0,0)").bind(input.name, input.path, input.method ?? "POST").run();
  else if (input.action === "release") await db.prepare("UPDATE wire_stripe_gates SET released=1 WHERE name=?").bind(input.name).run();
  else await waitFor(db, input.name, "entered");
  return Response.json({ ok: true });
}

async function waitFor(db: D1Database, name: string, column: "entered" | "released") {
  const end = Date.now() + 30_000;
  while (!(await db.prepare(`SELECT ${column} AS ready FROM wire_stripe_gates WHERE name=?`).bind(name).first<{ ready: number }>())?.ready) {
    if (Date.now() > end) throw new Error(`Stripe barrier ${column} timed out`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
