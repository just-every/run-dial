import { hasSupportedInstantPrecision } from "../../shared/instants";
import { stableJson } from "../../shared/stable-json";
import { hashToken } from "../../platform/auth/tokens";

export type OperatorCreationIdentity = { keyHash: string; payloadHash: string };
export type OperatorCreationPayload = {
  requestId?: string; operatorId: string; idempotencyKey?: string; eventTypeId: string;
  startAt: string; inviteeTimezone: string; name: string; email: string;
  answers: unknown; overrideNoticeAndHorizon: boolean;
};
export type OperatorCreationReceipt = { bookingId: string; operatorId: string; payloadHash: string };

export async function operatorCreationIdentity(input: OperatorCreationPayload, secret: string): Promise<OperatorCreationIdentity | undefined> {
  if (!input.idempotencyKey || !hasSupportedInstantPrecision(input.startAt) || !Number.isFinite(Date.parse(input.startAt))) return undefined;
  const payload = { ...(input.requestId ? { requestId: input.requestId } : {}), eventTypeId: input.eventTypeId, startAt: new Date(input.startAt).toISOString(), inviteeTimezone: input.inviteeTimezone, name: input.name.trim(), email: input.email.trim().toLowerCase(), answers: input.answers, overrideNoticeAndHorizon: input.overrideNoticeAndHorizon };
  const [keyHash, payloadHash] = await Promise.all([
    hashToken(`operator-create.v1:${input.operatorId}:${input.idempotencyKey}`, secret),
    hashToken(`operator-create-payload.v1:${stableJson(payload)}`, secret),
  ]);
  return { keyHash, payloadHash };
}

export function readOperatorCreation(binding: D1Database, keyHash: string) {
  return binding.prepare("SELECT booking_id AS bookingId, operator_id AS operatorId, payload_hash AS payloadHash FROM operator_creation_receipts WHERE key_hash = ?").bind(keyHash).first<OperatorCreationReceipt>();
}
export async function isErasedOperatorCreation(binding: D1Database, keyHash: string, operatorId: string) {
  return Boolean(await binding.prepare("SELECT key_hash FROM operator_creation_tombstones WHERE key_hash = ? AND operator_id = ?").bind(keyHash, operatorId).first());
}
export function operatorCreationStatement(binding: D1Database, identity: OperatorCreationIdentity, operatorId: string, bookingId: string, now: string) {
  return binding.prepare("INSERT INTO operator_creation_receipts (key_hash, operator_id, payload_hash, booking_id, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)").bind(identity.keyHash, operatorId, identity.payloadHash, bookingId, now, bookingId);
}
