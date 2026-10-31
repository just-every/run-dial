import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { AppServices } from "../core/app/services";
import { hostDateSchema } from "../core/shared/scheduling";
import { reportTileKeys } from "../core/features/reports/client";
import { bookingReadClass, bookingResult, stateDigest } from "./booking-native-state";
import { resourceText } from "./resource-definition";
import { nativeTool, objectOutput } from "./native-tool";

const period = z.object({ fromDate: hostDateSchema.optional(), throughDate: hostDateSchema.optional(), eventTypeId: z.string().length(26).optional() }).strict();
// A tracked source or cancellation reason may itself contain a private URL.
// Opaque bucket handles retain exact native drill-through without returning it.
const bucketHandle = async (bucket: string) => resourceText(bucket) === bucket ? bucket : `private-bucket:${await stateDigest(bucket)}`;

export function reportingTools(services: AppServices): ToolDefinition[] {
  return [
    nativeTool({
      name: "dial.reports.scheduling", title: "Read scheduling analytics", scope: "dial:read", readOnly: true,
      description: "Run the native single-host scheduling report in host dates, at most 366 days. Defaults to the 30 days through today. Definitions, imported counts and exact native money outcomes accompany every tile.",
      input: period, outputSchema: objectOutput, classes: ["sensitive"], clauses: ["REPORT-001", "PAY-003"], untrusted: true,
      classify: () => bookingReadClass(),
      async run(args) {
        const result = await services.reports.report(args);
        if (result.kind !== "report") throw new ToolRefusal(result.kind);
        return { result: { ...result.report, tiles: await Promise.all(result.report.tiles.map(async tile => ({ ...tile,
          groups: await Promise.all(tile.groups.map(async group => ({ ...group, rows: await Promise.all(group.rows.map(async row => ({
            ...row, label: resourceText(row.label), bucket: await bucketHandle(row.bucket),
          }))) }))) }))) } };
      },
    }),
    nativeTool({
      name: "dial.reports.drill_through", title: "Read report tile bookings", scope: "dial:read", readOnly: true,
      description: "Use the native report member set to page exactly the bookings counted by one tile or returned bucket key. Supply the report's original host-date period. Up to 500 records per page, default 100.",
      input: period.extend({ fromDate: hostDateSchema, throughDate: hostDateSchema, tile: z.enum(reportTileKeys), bucket: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(500).default(100), offset: z.number().int().min(0).max(1_000_000).default(0) }),
      outputSchema: objectOutput, classes: ["sensitive"], clauses: ["REPORT-001", "REPORT-002"], untrusted: true,
      classify: args => bookingReadClass(args.limit),
      async run({ tile, bucket, limit, offset, ...period }) {
        let nativeBucket = bucket;
        if (bucket?.startsWith("private-bucket:")) {
          const report = await services.reports.report(period);
          if (report.kind !== "report") throw new ToolRefusal(report.kind);
          const candidates = report.report.tiles.find(entry => entry.key === tile)?.groups.flatMap(group => group.rows) ?? [];
          const handles = await Promise.all(candidates.map(async row => ({ native: row.bucket, handle: await bucketHandle(row.bucket) })));
          nativeBucket = handles.find(entry => entry.handle === bucket)?.native;
          if (!nativeBucket) throw new ToolRefusal("report_bucket_not_found");
        }
        const members = await services.reports.members(period, tile, nativeBucket);
        if (members.kind !== "members") throw new ToolRefusal(members.kind);
        const listed = await services.bookings.listForOperatorWithCount({ ids: members.ids, eventTypeId: period.eventTypeId, limit, offset });
        return { result: { bookings: listed.bookings.map(bookingResult), totalCount: listed.totalCount, limit, offset, tile, bucket: bucket ? resourceText(bucket) : null } };
      },
    }),
  ];
}
