import { createId } from "../../shared/ids";
import type { ClickIds } from "./types";

/** Only the initial booking transaction invokes this; payment and approval holds carry the same click context. */
export function conversionStatements(db: D1Database, input: { bookingId: string; now: string; clickIds?: ClickIds; embedded?: boolean }) {
  if (input.embedded) return [];
  return ([['google_ads', input.clickIds?.gclid], ['linkedin', input.clickIds?.li_fat_id]] as const).flatMap(([provider, click]) => {
    if (!click) return [];
    const id = createId(), eventId = `dial-booking-${input.bookingId}-${provider}`;
    return [db.prepare(`INSERT INTO analytics_deliveries(id,booking_id,provider,generation,event_id,click_id,destination_json,confirmed_at,state,next_attempt_at,created_at,updated_at)
      SELECT ?,b.id,c.provider,c.generation,?,?,c.destination_json,?,'pending',?,?,?
      FROM bookings b JOIN analytics_connections c ON c.provider=? AND c.status='connected' AND c.credential_ciphertext IS NOT NULL
      WHERE b.id=? AND b.imported=0 AND b.state='confirmed'
      ON CONFLICT(booking_id,provider) DO NOTHING`).bind(id,eventId,click,input.now,input.now,input.now,input.now,provider,input.bookingId)];
  });
}
