import type { AppServices } from "./core/app/services";

/** A used workspace has internal context alongside its scheduling records. */
export async function seedDemoFields(services: AppServices) {
  const groups = [
    { entity: "eventType" as const, ids: (await services.eventTypes.listEventTypes()).map(record => record.id), label: "Preparation", value: "Review the guest's agenda before the session." },
    { entity: "booking" as const, ids: (await services.bookings.listForOperator({})).map(record => record.id), label: "Follow-up", value: "Share a short decision summary after the call." },
    { entity: "availabilityRequest" as const, ids: (await services.availabilityRequests.listForOperator()).map(record => record.id), label: "Next step", value: "Offer the requested window and confirm the agenda." },
  ];
  for (const group of groups) {
    const fields = await services.customFields.definitions(group.entity);
    const field = fields.find(field => field.label === group.label) ?? await services.customFields.create({ entity: group.entity, label: group.label, kind: "text", options: [] });
    if (!field) throw new Error("Demo custom field was not created");
    for (const id of group.ids) {
      if (await services.customFields.set(group.entity, id, field.id, group.value) !== "saved") throw new Error("Demo custom field was not saved");
    }
  }
}
