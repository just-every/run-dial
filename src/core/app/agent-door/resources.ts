import type { ResourceDefinition } from "../../../base/modules/agent-door/index.ts";
import type { AppServices } from "../services";
import { authorize } from "./native";

/** Catalogue and reads use native records; no bearer, cookie or provider data enters this registry. */
export function nativeResources(services: AppServices): ResourceDefinition[] {
  return ["hosts", "event-types", "schedules"].map((kind) => ({
    uriTemplate: `dial://${kind}/{id}`,
    name: kind,
    scope: "dial:read",
    classes: ["standard"],
    classify(record) {
      return [{ class: "standard", facts: { measure: record.json ? 1 : 0 } }];
    },
    async read(uri, ctx) {
      try {
        await authorize(ctx);
      } catch {
        return null;
      }
      const match = new RegExp(`^dial://${kind}/([0-9A-Z]{26})$`).exec(uri);
      if (!match) return null;
      const value =
        kind === "hosts"
          ? await services.hostProfile.getProfile()
          : kind === "event-types"
            ? await services.eventTypes.getEventType(match[1])
            : await services.namedSchedules.get(match[1]);
      if (!value || value.id !== match[1]) return null;
      if (kind === "hosts") {
        const {
          id,
          handle,
          name,
          title,
          biography,
          timezone,
          focusAreas,
          socialProof,
          createdAt,
          updatedAt,
        } = value as NonNullable<
          Awaited<ReturnType<AppServices["hostProfile"]["getProfile"]>>
        >;
        return {
          json: {
            id,
            handle,
            name,
            title,
            biography,
            timezone,
            focusAreas,
            socialProof,
            createdAt,
            updatedAt,
          },
          untrusted: true,
        };
      }
      return { json: value, untrusted: true };
    },
  }));
}
