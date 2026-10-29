import type { ResourceDefinition } from "../../../base/modules/agent-door/index.ts";
import type { AppServices } from "../services";
import { authorize } from "./native";

/** Catalogue and reads use native records; no bearer, cookie or provider data enters this registry. */
export function nativeResources(services: AppServices): ResourceDefinition[] {
  const resources: ResourceDefinition[] = [
    "hosts",
    "event-types",
    "schedules",
  ].map((kind) => ({
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
  resources.push({
    uriTemplate: "dial://activity/{id}",
    name: "Native action receipt",
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
      const match = /^dial:\/\/activity\/([a-f0-9-]{36})$/.exec(uri);
      if (!match) return null;
      const row = await ctx.db
        .prepare(
          "SELECT operation_id AS operationId,tool,target_kind AS targetKind,target_id AS targetId,prepared_by AS preparedBy,approvers,happened_at AS at FROM agent_native_activity WHERE operation_id=?",
        )
        .bind(match[1])
        .first<{
          operationId: string;
          tool: string;
          targetKind: string | null;
          targetId: string | null;
          preparedBy: string;
          approvers: string;
          at: string;
        }>();
      return row
        ? { json: { ...row, approvers: JSON.parse(row.approvers) } }
        : null;
    },
  });
  return resources;
}
