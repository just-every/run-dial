import { nowIso } from "../../shared/ids";

export class DeliveryPreferencesRepository {
  constructor(private readonly binding: D1Database) {}

  async get(operatorId: string) {
    const record = await this.binding.prepare("SELECT booking_mail_muted AS muted FROM operator_delivery_preferences WHERE operator_id = ?").bind(operatorId).first<{ muted: number }>();
    return { bookingMailMuted: record?.muted === 1 };
  }

  async set(operatorId: string, bookingMailMuted: boolean) {
    const now = nowIso();
    await this.binding.prepare("INSERT INTO operator_delivery_preferences (operator_id, booking_mail_muted, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(operator_id) DO UPDATE SET booking_mail_muted = excluded.booking_mail_muted, updated_at = excluded.updated_at").bind(operatorId, bookingMailMuted ? 1 : 0, now, now).run();
    return { bookingMailMuted };
  }
}
