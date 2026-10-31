import type { AppServices } from "../core/app/services";
import { nativeResource,recordCount,resourceText } from "./resource-definition";

export function peopleResources(services: AppServices) {
  return [nativeResource("clients", "Client record", async (id, ctx) => {
    // History-only email groupings have no native identity; never manufacture one.
    const profile = await ctx.db.prepare("SELECT id, email, revision, created_at AS createdAt, updated_at AS updatedAt FROM client_profiles WHERE id=?")
      .bind(id).first<{ id: string; email: string; revision: number; createdAt: string; updatedAt: string }>();
    if (!profile) return null;
    const details = await services.clients.records.details(profile.email);
    return {
      ...profile, aliases: details.aliases,
      notes: details.notes.map(note => ({ ...note, body: resourceText(note.body) })),
      fields: details.fields.map(field => ({ id: field.id, label: resourceText(field.label), value: resourceText(field.value) })),
    };
  }, record => ({ kind: recordCount(record.notes) || recordCount(record.fields) ? "client-with-private-notes-or-fields" : "client-identity" }))];
}
