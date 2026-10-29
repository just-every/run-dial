import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { stateDigest } from "./booking-native-state";

import { arrayOutput, live, nativeTool, objectOutput, required, standard } from "./native-tool";

const target = z.object({ id: z.string().regex(/^[0-9A-Z]{26}$/) }).strict();
const uri = (id: string) => `dial://polls/${id}`;

export function pollTools(services: AppServices): ToolDefinition[] {
  const host = async (id: string) => required(await services.polls.host(id));
  return [
    nativeTool({
      name: "dial.polls.grants", title: "Read poll voting grants", description: "Read the targeted native poll's current participant grant IDs without any voting capability.",
      scope: "dial:read", readOnly: true, input: target, outputSchema: objectOutput, classes: ["standard"], clauses: ["POLL-001"], classify: () => standard(),
      run: async args => { const poll = await host(args.id); return { result: { id: poll.id, grants: poll.state === "open" ? poll.participants.map(person => person.id) : [] } }; },
    }),
    nativeTool({
      name: "dial.polls.list", title: "List meeting polls", description: "Read the latest 100 native meeting polls and their open/closed state, without participant capabilities.",
      scope: "dial:read", readOnly: true, input: z.object({}).strict(), outputSchema: arrayOutput, classes: ["standard"], clauses: ["POLL-001"],
      classify: () => standard(0), run: async () => ({ result: await services.polls.repository.list() }),
    }),
    nativeTool({
      name: "dial.polls.read", title: "Read meeting poll", description: "Read the host view of candidates, participants, votes and participant revisions. Does not reveal vote tokens or grant voting authority.",
      scope: "dial:read", readOnly: true, input: target, outputSchema: objectOutput, classes: ["sensitive"], clauses: ["POLL-001"], untrusted: true,
      classify: async args => [{ class: "sensitive", facts: { measure: (await host(args.id)).participants.length, kind: "meeting poll participants and votes" } }],
      run: async args => ({ result: await host(args.id) }),
    }),
    nativeTool({
      name: "dial.polls.set_tally", title: "Set participant tally visibility", description: "Choose whether participants see the tally through their own native poll capability.",
      scope: "dial:write", readOnly: false, input: target.extend({ show: z.boolean() }).strict(), outputSchema: objectOutput, classes: ["standard", "access"], clauses: ["POLL-001"],
      classify: async args => {
        const poll = await host(args.id);
        return Boolean(poll.showTally) === args.show ? standard(0) : [...standard(), { class: "access", facts: { measure: poll.participants.length, direction: args.show ? "widens" : "narrows" } }];
      },
      authority: async args => ({ subject: `poll-participants:${args.id}`, widens: args.show && !(await host(args.id)).showTally }),
      revisionType: "string", revision: async args => stateDigest(await host(args.id)),
      summary: async args => ({ target: { id: args.id, name: (await host(args.id)).title }, items: [args.show ? "Show vote tally to this poll's participants" : "Hide vote tally from this poll's participants"] }),
      async run(args, ctx) {
        if (!await services.polls.repository.settings(args.id, args.show)) throw new ToolRefusal("poll_unavailable");
        ctx.emit("dial.poll.tally_changed", uri(args.id), { show: args.show, actorLabel: ctx.actor.label });
        return { result: { updated: true } };
      },
    }),
    nativeTool({
      name: "dial.polls.close", title: "Close meeting poll", description: "Close a native poll, stop pending invitations and release its held times. No winning-time booking or participant voting is performed.",
      scope: "dial:write", readOnly: false, input: target, outputSchema: objectOutput, classes: ["standard", "access", "live"], clauses: ["POLL-001"],
      widens: false, narrowing: { effect: "revoke", target: "id" },
      classify: async args => {
        const poll = await host(args.id);
        return [...standard(), { class: "access", facts: { measure: poll.participants.length, direction: "narrows" } }, ...(poll.holdLinkId ? [live("booking availability")] : [])];
      },
      authority: async args => ({ subject: `poll-participants:${args.id}`, widens: false }),
      revisionType: "string", revision: async args => stateDigest(await host(args.id)),
      summary: async args => ({ target: { id: args.id, name: (await host(args.id)).title }, items: ["Close voting, stop pending invitations and release candidate holds"] }),
      async run(args, ctx) {
        await host(args.id);
        await services.polls.repository.close(args.id);
        ctx.emit("dial.poll.closed", uri(args.id), { actorLabel: ctx.actor.label });
        return { result: { closed: true } };
      },
    }),
  ];
}
