/** Only approval money commands share the pending booking's coordinator. Ordinary late balance/invoice
 * callbacks keep their existing atomic settlement path. Signature and account admission still happen inside it. */
export async function paymentApprovalTarget(request: Request, db: D1Database): Promise<string | undefined> {
  const event = await request.clone().json().catch(() => null) as { data?: { object?: Record<string, unknown> } } | null;
  const object = event?.data?.object;
  if (!object || typeof object.id !== "string") return undefined;
  const metadata = object.metadata as Record<string, unknown> | undefined;
  if (typeof metadata?.dial_hold_id === "string") {
    const hold = await db.prepare(`SELECT json_extract(claim_json,'$.bookingId') AS id FROM payment_holds
      WHERE id=? AND json_extract(claim_json,'$.money.approval') IS NOT NULL`).bind(metadata.dial_hold_id).first<{ id: string }>();
    if (hold?.id) return hold.id;
  }
  const intent = typeof object.payment_intent === "string" ? object.payment_intent : object.id;
  return (await db.prepare(`SELECT booking_id AS id FROM booking_approval_requests WHERE payment_json IS NOT NULL
    AND (json_extract(payment_json,'$.paymentIntentId')=? OR json_extract(payment_json,'$.setupIntentId')=?
      OR json_extract(payment_json,'$.refundId')=?) LIMIT 1`).bind(intent, object.id, object.id).first<{ id: string }>())?.id;
}
