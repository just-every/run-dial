import { customFieldRoutes, createCustomFields } from "../../ext/index.server";
import type { RouteContributionId } from "../api/extensions";
const contributions = { "operator.route.v1": customFieldRoutes } satisfies Record<RouteContributionId, typeof customFieldRoutes>;
export const extensionRoutes = contributions["operator.route.v1"];
export { createCustomFields };
