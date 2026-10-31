import { emailFoldSql } from "../erasure";

/** One address and booking pair, independent of its primary or guest role.
 * Resolve client aliases after this projection, then count distinct bookings.
 */
export const clientParticipationSql = `client_participation AS (
  SELECT id AS booking_id,invitee_email_folded AS email FROM bookings
  UNION
  SELECT g.booking_id,${emailFoldSql("g.email")} AS email
  FROM booking_guests g JOIN bookings b ON b.id=g.booking_id
)`;

/** The JSON address set is bound by the caller, including inside write batches. */
export const clientExistsSql = `EXISTS(WITH ${clientParticipationSql}
  SELECT 1 FROM client_participation WHERE email IN(SELECT value FROM json_each(?)))`;
