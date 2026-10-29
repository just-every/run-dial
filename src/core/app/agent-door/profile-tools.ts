import { z } from "zod";
import { authorize } from "./native";
import { schema, profileInput } from "./schemas";
import {
  standard,
  live,
  resource,
  type NativeToolContext,
} from "./tool-context";
export function profileTools({
  add,
  env,
  services,
  forEffect,
}: NativeToolContext) {
  add("workspace", "snapshot", {
    scope: "dial:read",
    readOnly: true,
    inputSchema: schema(z.object({})),
    classes: ["standard"],
    clauses: ["BASE-AGENT-009"],
    classify: async (_args, ctx) => {
      await authorize(ctx);
      return standard;
    },
    run: async (_args, ctx) => {
      await authorize(ctx);
      const [profile, events, schedules, activity] = await Promise.all([
        services.hostProfile.getProfile(),
        services.eventTypes.listEventTypes(),
        services.namedSchedules.list(),
        env.DB.prepare(
          "SELECT operation_id,tool,target_kind,target_id,sponsor_id,agent_id,prepared_by,approvers FROM agent_native_activity ORDER BY operation_id",
        ).all(),
      ]);
      return {
        result: {
          profile: profile ?? null,
          events,
          schedules,
          activity: activity.results,
        },
      };
    },
  });
  add("profile", "read", {
    scope: "dial:read",
    readOnly: true,
    inputSchema: schema(z.object({})),
    classes: ["standard"],
    clauses: ["PROFILE-001"],
    classify: async (_args, ctx) => {
      await authorize(ctx);
      return standard;
    },
    run: async (_args, ctx) => {
      await authorize(ctx);
      return {
        result: { record: (await services.hostProfile.getProfile()) ?? null },
      };
    },
  });
  add("profile", "save", {
    scope: "dial:configure",
    readOnly: false,
    inputSchema: schema(profileInput),
    classes: ["live"],
    clauses: ["PROFILE-001"],
    classify: async (args, ctx) => {
      await authorize(ctx);
      profileInput.parse(args);
      return live;
    },
    revisionType: "string",
    revision: async (_args, ctx) => {
      await authorize(ctx);
      return (await services.hostProfile.getProfile())?.updatedAt ?? null;
    },
    summary: (args) => ({
      target: { name: profileInput.parse(args).name },
      items: ["Public host profile"],
    }),
    run: async (args, ctx) => {
      await authorize(ctx);
      const previous = await services.hostProfile.getProfile();
      const value = await forEffect(
        ctx,
        "dial.profile.save",
        previous ? { kind: "host", id: previous.id } : null,
        previous
          ? {
              table: "host_profiles",
              id: previous.id,
              value: previous.updatedAt,
            }
          : undefined,
      ).hostProfile.saveProfile(profileInput.parse(args));
      return { result: { record: value }, resources: resource("hosts", value) };
    },
  });
}
