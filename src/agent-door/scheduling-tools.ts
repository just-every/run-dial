import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { ianaTimeZoneSchema } from "../core/shared/scheduling";
import { availabilityTools } from "./availability-tools";
import { calendarTools } from "./calendar-tools";
import { eventTools } from "./event-tools";
import { external, live, nativeTool, objectOutput, standard } from "./native-tool";

// The profile route does not export its schema; these are its same native field limits.
const profileInput = z.object({
  handle: z.string().regex(/^[a-z0-9-]+$/).max(80),
  name: z.string().min(1).max(120),
  title: z.string().min(1).max(180),
  biography: z.string().min(1).max(2000),
  timezone: ianaTimeZoneSchema,
  focusAreas: z.array(z.object({ label: z.string().min(1).max(40) }).strict()).max(6),
  socialProof: z.array(z.object({ quote: z.string().min(1).max(280), attribution: z.string().min(1).max(120) }).strict()).max(3),
}).strict();

/** Native single-host scheduling commands; avatar files and OAuth remain their native doors. */
export function schedulingTools(services: AppServices): ToolDefinition[] {
  return [
    nativeTool({
      name: "dial.profile.get", title: "Read host profile", description: "Read the configured native host profile, or null before setup.",
      scope: "dial:read", readOnly: true, input: z.object({}).strict(), outputSchema: { anyOf: [objectOutput, { type: "null" }] },
      classes: ["standard"], clauses: ["PROFILE-001", "PROFILE-002"], classify: () => standard(),
      run: async () => ({ result: await services.hostProfile.getProfile() ?? null }),
    }),
    nativeTool({
      name: "dial.profile.save", title: "Save host profile", description: "Replace the host's public profile text and timezone using the native profile writer.",
      scope: "dial:write", readOnly: false, input: profileInput, outputSchema: objectOutput,
      classes: ["live", "external"], clauses: ["PROFILE-001", "PROFILE-002", "AVAIL-005"],
      classify: () => [live("Dial public profile and booking timezone"), external(1, "public")],
      revisionType: "string", revision: async () => (await services.hostProfile.getProfile())?.updatedAt ?? null,
      summary: async args => {
        const profile = await services.hostProfile.getProfile();
        return { target: profile ? { id: profile.id, name: profile.name } : { name: "Host profile" }, items: [
          `Publish profile at /book/${args.handle}`, `Name: ${args.name}`, `Title: ${args.title}`, `Biography: ${args.biography}`,
          `Host timezone: ${args.timezone}`, `Focus areas: ${JSON.stringify(args.focusAreas)}`, `Social proof: ${JSON.stringify(args.socialProof)}`,
        ] };
      },
      run: async args => ({ result: await services.hostProfile.saveProfile(args) }),
    }),
    ...eventTools(services), ...availabilityTools(services), ...calendarTools(services),
  ];
}
