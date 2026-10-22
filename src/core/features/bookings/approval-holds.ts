import type { InternalClaim } from "../availability/engine";
/** Only live tentative requests occupy time. Expired holds release immediately, independently of mail dispatch. */
export function approvalHoldPredicate(startAt: string, endAt: string, exceptId?: string) {
    return { sql: "NOT EXISTS(SELECT 1 FROM booking_approval_requests a WHERE a.state='pending' AND a.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND a.occupied_start_at<? AND a.occupied_end_at>? AND (? IS NULL OR a.id<>?))", params: [endAt, startAt, exceptId ?? null, exceptId ?? null] };
}
export async function activeApprovalIntervals(db: D1Database, startAt: string, endAt: string, exceptBookingId?: string): Promise<InternalClaim[]> {
    return (await db.prepare("SELECT occupied_start_at AS startAt,occupied_end_at AS endAt,host_date AS hostDate,start_at AS bookingStartAt,end_at AS bookingEndAt FROM booking_approval_requests WHERE state='pending' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND occupied_start_at<? AND occupied_end_at>? AND (? IS NULL OR booking_id<>?)").bind(endAt, startAt, exceptBookingId ?? null, exceptBookingId ?? null).all<InternalClaim>()).results;
}
