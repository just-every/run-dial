import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { stateDigest } from "./booking-native-state";
import { nativeTool,objectOutput,standard } from "./native-tool";

const email = z.string().trim().email().max(320);
const page = z.object({ limit: z.number().int().min(1).max(100).default(100), offset: z.number().int().min(0).max(1_000_000).default(0) }).strict();
const sensitive = (measure: number) => [{ class: "sensitive" as const, facts: { measure, kind: "client scheduling records" } }];

export function clientTools(services: AppServices): ToolDefinition[] {
  const records = services.clients.records;
  const uri = async (address: string) => {
    const profile = await records.profile(address);
    if (!profile) throw new ToolRefusal("client_not_found");
    return `dial://clients/${profile.id}`;
  };
  const known = async (address: string) => {
    if (!(await services.clients.history(address, 1, 0)).totalCount) throw new ToolRefusal("client_not_found");
    return records.details(address);
  };
  const revision = async (address: string) => (await records.profile(address))?.revision ?? 0;
  return [
    nativeTool({
      name: "dial.clients.list", title: "List clients", description: "Read primary-invitee client identities and booking counts, including merged aliases. Paginated up to 100 clients.",
      scope: "dial:read", readOnly: true, input: page, outputSchema: objectOutput, classes: ["sensitive"], clauses: ["CLIENT-001"],
      classify: async args => sensitive((await services.clients.list(args.limit, args.offset)).clients.length),
      run: async args => ({ result: await services.clients.list(args.limit, args.offset) }),
    }),
    nativeTool({
      name: "dial.clients.history", title: "Read client history", description: "Read native client notes, text fields, aliases and paginated bookings with answers, attendance, payment state and annotations. No booking manage capabilities.",
      scope: "dial:read", readOnly: true, input: page.extend({ email }).strict(), outputSchema: objectOutput, classes: ["sensitive"], clauses: ["CLIENT-001", "CUSTOM-002"], untrusted: true,
      classify: async args => sensitive((await services.clients.history(args.email, args.limit, args.offset)).ids.length + 1),
      async run(args) {
        const history = await services.clients.history(args.email, args.limit, args.offset);
        const bookings = [];
        for (const id of history.ids) {
          const booking = await services.bookings.getForOperator(id);
          if (!booking) continue; // Concurrent erasure must not return an old projection.
          bookings.push({ id: booking.id, name: booking.inviteeName, email: booking.inviteeEmail,
            eventTitle: booking.eventTitle, eventTypeId: booking.eventTypeId, state: booking.state,
            startAt: booking.occurrence.startAt, endAt: booking.occurrence.endAt,
            hostTimezone: booking.hostTimezone, inviteeTimezone: booking.inviteeTimezone,
            answers: booking.answers, attendance: booking.attendance, payment: booking.payment ?? null,
            customFields: await services.customFields.entries("booking", id) });
        }
        return { result: { ...await records.details(args.email), totalCount: history.totalCount, bookings } };
      },
    }),
    nativeTool({
      name: "dial.clients.add_note", title: "Add client note", description: "Add a private scheduling note to an existing client as the current native owner.",
      scope: "dial:write", readOnly: false, input: z.object({ email, body: z.string().trim().min(1).max(5000) }).strict(), outputSchema: objectOutput, classes: ["standard"], clauses: ["CLIENT-001"],
      classify: () => standard(), revisionType: "integer", revision: args => revision(args.email),
      summary: async args => ({ target: { email: (await known(args.email)).email }, items: ["Add a private client note", args.body] }),
      async run(args, ctx) {
        const id = await records.add(args.email, { body: `${ctx.actor.label}\n\n${args.body}`, operatorId: ctx.person.id });
        if (!id) throw new ToolRefusal("client_not_found");
        ctx.emit("dial.client.note_added", await uri(args.email), { id, actorLabel: ctx.actor.label });
        return { result: { id } };
      },
    }),
    nativeTool({
      name: "dial.clients.add_field", title: "Add client text field", description: "Add a native private client text annotation, up to 20 per client. These are not shared typed field definitions.",
      scope: "dial:write", readOnly: false, input: z.object({ email, label: z.string().trim().min(1).max(120), value: z.string().trim().min(1).max(5000) }).strict(), outputSchema: objectOutput, classes: ["standard"], clauses: ["CLIENT-001"],
      classify: () => standard(), revisionType: "integer", revision: args => revision(args.email),
      summary: async args => ({ target: { email: (await known(args.email)).email }, items: [args.label, args.value] }),
      async run(args, ctx) {
        const id = await records.add(args.email, { label: args.label, value: args.value });
        if (!id) throw new ToolRefusal("client_field_refused");
        ctx.emit("dial.client.field_added", await uri(args.email), { id, actorLabel: ctx.actor.label });
        return { result: { id } };
      },
    }),
    nativeTool({
      name: "dial.clients.merge", title: "Merge clients", description: "Merge two existing client records, retaining booking rows, aliases, notes and text fields and removing the source profile. The native audit names the agent as preparer, its sponsoring owner and any real approvers.",
      scope: "dial:write", readOnly: false, input: z.object({ source: email, target: email }).strict(), outputSchema: objectOutput, classes: ["standard", "destructive"], clauses: ["CLIENT-001"],
      classify: () => [...standard(), { class: "destructive", facts: { measure: 1 } }], revisionType: "string",
      revision: async args => stateDigest(await Promise.all([records.profile(args.source), records.profile(args.target)])),
      summary: async args => ({ target: { email: (await known(args.target)).email }, items: [`Merge ${(await known(args.source)).email} into this client; keep its aliases and scheduling history`] }),
      async run(args, ctx) {
        const outcome = await records.merge(args.source, args.target, ctx.person.id, {
          id: ctx.agent.id, label: ctx.actor.label, approvers: ctx.approvers,
        });
        if (outcome !== "merged") throw new ToolRefusal(outcome === "missing" ? "client_not_found" : "client_identical");
        ctx.emit("dial.client.merged", await uri(args.target), { actorLabel: ctx.actor.label });
        return { result: { merged: true } };
      },
    }),
  ];
}
