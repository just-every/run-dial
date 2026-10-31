export type ProductChange = { name: string; sessions: number; amountCents: number; validityDays: number };

/** The host's catalog for one event: each product with how many purchases it already has. */
export async function catalogWithSales(db: D1Database, eventId: string) {
  return (await db.prepare(`SELECT p.id,p.kind,p.name,p.sessions,p.amount_cents AS amountCents,p.validity_days AS validityDays,
    (SELECT count(*) FROM payment_entitlements e WHERE e.product_id=p.id) AS sold
    FROM payment_products p WHERE p.event_type_id=? AND p.is_coupon=0 ORDER BY p.id`).bind(eventId).all()).results;
}

/** Existing purchases keep the sessions, price and validity they were bought with; only the offer changes. */
export async function changeProduct(db: D1Database, eventId: string, id: string, input: ProductChange, now: string) {
  const result = await db.prepare("UPDATE payment_products SET name=?,sessions=?,amount_cents=?,validity_days=?,updated_at=? WHERE id=? AND event_type_id=? AND is_coupon=0")
    .bind(input.name, input.sessions, input.amountCents, input.validityDays, now, id, eventId).run();
  return result.meta.changes === 1;
}

/** A product with purchases stays in the catalog: its buyers' balances are named after it. */
export async function removeProduct(db: D1Database, eventId: string, id: string) {
  const product = await db.prepare("SELECT id FROM payment_products WHERE id=? AND event_type_id=? AND is_coupon=0").bind(id, eventId).first();
  if (!product) return "not_found" as const;
  const result = await db.prepare("DELETE FROM payment_products WHERE id=? AND NOT EXISTS(SELECT 1 FROM payment_entitlements WHERE product_id=?)").bind(id, id).run();
  return result.meta.changes === 1 ? "removed" as const : "sold" as const;
}
