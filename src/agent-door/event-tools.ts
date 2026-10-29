import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { eventDetailsInputSchema, eventTypeCreationSchema, eventTypeInputSchema } from "../core/features/event-types/event-input";
import { eventConfigurationTools } from "./event-configuration-tools";
import { eventHoursTools } from "./event-hours-tools";
import { eventIdInput, eventRecord, eventWrite, validateEventQuestions } from "./event-tool-support";
import { arrayOutput, nativeTool, objectOutput, required, standard } from "./native-tool";

export function eventTools(services: AppServices): ToolDefinition[] {
  const read = { scope: "dial:read", readOnly: true, classes: ["standard"] as ["standard"], classify: () => standard() };
  const editClauses = ["EVENT-001", "EVENT-002", "EVENT-003", "EVENT-004", "EVENT-011", "NOTIFY-009"];
  return [
    nativeTool({
      ...read, name: "dial.event.list", title: "List event types", description: "List all native event types, including drafts and disabled offers.",
      input: z.object({}).strict(), outputSchema: arrayOutput, clauses: ["EVENT-001"],
      run: async () => ({ result: await services.eventTypes.listEventTypes() }),
    }),
    nativeTool({
      ...read, name: "dial.event.get", title: "Read event type", description: "Read one native event type with its questions and effective recurring windows.",
      input: z.object({ id: z.string().min(1).max(200) }).strict(), outputSchema: objectOutput, clauses: ["EVENT-001", "EVENT-002", "EVENT-003", "EVENT-004"],
      run: async args => ({ result: await eventRecord(services, args.id) }),
    }),
    nativeTool({
      name: "dial.event.create", title: "Create draft event type", description: "Create a native draft. Omitted hours use Your hours; publication is a separate command.",
      scope: "dial:write", readOnly: false, input: eventTypeCreationSchema.strict(), outputSchema: objectOutput,
      classes: ["standard"], clauses: editClauses, classify: () => standard(),
      summary: args => ({ target: { name: args.title }, items: ["Create a draft event type", `Settings: ${JSON.stringify(args)}`] }),
      run: async args => ({ result: await services.eventTypes.createEventType(args) }),
    }),
    nativeTool({
      name: "dial.event.duplicate", title: "Duplicate event type", description: "Copy a native event type into a new draft with its native settings and schedule binding.",
      scope: "dial:write", readOnly: false, input: eventIdInput, outputSchema: objectOutput,
      classes: ["standard"], clauses: ["EVENT-001", "NOTIFY-009", "AVAIL-011"],
      classify: async args => { await eventRecord(services, args.id); return standard(); },
      revisionType: "string", revision: async args => (await eventRecord(services, args.id)).updatedAt,
      summary: async args => { const event = await eventRecord(services, args.id); return { target: { id: event.id, name: event.title }, items: ["Create a draft copy without bookings, requests or history"] }; },
      run: async args => ({ result: required(await services.eventTypes.duplicateEventType(args.id)) }),
    }),
    eventWrite(services, {
      name: "dial.event.update_details", title: "Update event details", description: "Replace native event details while preserving hours and alternative-request settings. Referenced template questions remain protected.",
      input: z.object({ id: eventIdInput.shape.id, details: eventDetailsInputSchema.strict() }).strict(), clauses: editClauses,
      items: args => ["Replace event details", `Details: ${JSON.stringify(args.details)}`],
      run: async args => {
        await validateEventQuestions(services, args.id, args.details.questions);
        return { result: required(await services.eventTypes.updateEventDetails(args.id, args.details)) };
      },
    }),
    eventWrite(services, {
      name: "dial.event.update", title: "Replace event configuration", description: "Replace the full native event configuration, including weekly hours and alternative requests. Changed hours detach the event from a shared schedule.",
      input: z.object({ id: eventIdInput.shape.id, event: eventTypeInputSchema.strict() }).strict(), clauses: [...editClauses, "AVAIL-001", "AVAIL-011"],
      items: args => ["Replace complete event configuration", `Settings: ${JSON.stringify(args.event)}`],
      run: async args => {
        await validateEventQuestions(services, args.id, args.event.questions);
        return { result: required(await services.eventTypes.updateEventType(args.id, args.event)) };
      },
    }),
    eventWrite(services, {
      name: "dial.event.set_alternative_requests", title: "Set alternative-time requests", description: "Enable or disable the native event's alternative-time request option.",
      input: eventIdInput.extend({ enabled: z.boolean() }).strict(), clauses: ["EVENT-001", "EVENT-006", "REQUEST-001"],
      items: args => [`Alternative-time requests: ${args.enabled ? "enabled" : "disabled"}`],
      run: async args => ({ result: required(await services.eventTypes.setAlternativeRequests(args.id, args.enabled)) }),
    }),
    nativeTool({
      ...read, name: "dial.event.readiness", title: "Read publication readiness", description: "Read native publication and request-opening readiness from recorded provider health, including missing requirements and health age. Publishing performs live checks.",
      input: eventIdInput, outputSchema: objectOutput, clauses: ["EVENT-006", "CAL-006"],
      run: async args => ({ result: required(await services.eventTypes.getReadiness(args.id)) }),
    }),
    nativeTool({
      ...read, name: "dial.event.preview", title: "Read event preview", description: "Read the native public-shaped event preview with the configured host profile.",
      input: eventIdInput, outputSchema: objectOutput, clauses: ["EVENT-001", "PROFILE-001"],
      run: async args => {
        const [eventType, profile] = await Promise.all([services.eventTypes.getEventTypePreview(args.id), services.hostProfile.getProfile()]);
        return { result: { profile: required(profile), eventType: required(eventType) } };
      },
    }),
    eventWrite(services, {
      name: "dial.event.publish", title: "Publish event type", description: "Run native live mail/calendar readiness checks and publish the event for real bookings only when its requirements pass.",
      input: eventIdInput, clauses: ["EVENT-001", "EVENT-006", "AVAIL-004"], publicWrite: true,
      items: (_args, event) => ["Publish this event for real bookings", `Public path: ${event.slug}`, "Check the native mail and calendar requirements before publication"],
      run: async args => {
        const result = await services.eventTypes.publishEventType(args.id);
        if (result.kind !== "published") throw new ToolRefusal(result.kind === "event_not_found" ? "not_found" : "event_not_ready", "The event could not be published.", result.kind === "not_ready" ? { requirements: result.readiness.missing } : {});
        return { result: result.eventType };
      },
    }),
    eventWrite(services, {
      name: "dial.event.open_requests", title: "Open event for requests", description: "Run native request-opening readiness checks and publish a draft or disabled event in request-only mode.",
      input: eventIdInput, clauses: ["EVENT-006", "REQUEST-001", "REQUEST-004"], publicWrite: true,
      items: () => ["Publish this event in request-only mode", "Require a valid host profile, alternative requests and a verified mail sender"],
      run: async args => {
        const result = await services.eventTypes.openRequests(args.id);
        if (result.kind !== "published") throw new ToolRefusal(result.kind === "event_not_found" ? "not_found" : "event_not_ready", "The event could not be opened for requests.", result.kind === "not_ready" ? { requirements: result.readiness.missing } : {});
        return { result: result.eventType };
      },
    }),
    eventWrite(services, {
      name: "dial.event.disable", title: "Disable event type", description: "Disable the native event's public page and future availability while retaining bookings and their history.",
      input: eventIdInput, clauses: ["EVENT-001", "EVENT-005"], items: () => ["Disable this event and its public booking page; retain existing bookings"],
      run: async args => ({ result: required(await services.eventTypes.disableEventType(args.id)) }),
    }),
    eventWrite(services, {
      name: "dial.event.delete", title: "Delete event type", description: "Delete the native event and its offer configuration. Existing bookings retain their native copies, times, management links and history.",
      input: eventIdInput, clauses: ["EVENT-001", "EVENT-005"], destructive: true,
      items: () => ["Delete this event type and its offer configuration; retain existing bookings"],
      run: async args => {
        if (!await services.eventTypes.deleteEventType(args.id)) throw new ToolRefusal("not_found");
        return { result: { id: args.id, deleted: true } };
      },
    }),
    ...eventHoursTools(services), ...eventConfigurationTools(services),
  ];
}
