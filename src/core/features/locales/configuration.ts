import { z } from "zod";
import { nextEventTimestampSql } from "../../shared/event-revision";

export const confirmationLanguageSchema = z.object({ confirmationLanguage: z.enum(["en", "es"]) }).strict();
export type ConfirmationLanguageConfiguration = z.infer<typeof confirmationLanguageSchema>;

/** Calling native routes supply owner-session authority. */
export class EventConfirmationLanguages {
  constructor(private readonly binding: D1Database) {}

  async read(eventTypeId: string): Promise<ConfirmationLanguageConfiguration | null> {
    const row = await this.binding.prepare("SELECT confirmation_language AS confirmationLanguage FROM event_types WHERE id = ?")
      .bind(eventTypeId).first<ConfirmationLanguageConfiguration>();
    return row ? confirmationLanguageSchema.parse(row) : null;
  }

  async save(eventTypeId: string, input: ConfirmationLanguageConfiguration, now: string) {
    const configuration = confirmationLanguageSchema.parse(input);
    const result = await this.binding.prepare(`UPDATE event_types SET confirmation_language = ?, updated_at = ${nextEventTimestampSql} WHERE id = ?`)
      .bind(configuration.confirmationLanguage, now, eventTypeId).run();
    return result.meta.changes > 0 ? configuration : null;
  }
}
