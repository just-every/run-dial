/** Source-authored extension seam; no package discovery or runtime loader. */
export type { AppEnvironment } from "../app/context";
export { Button, Card } from "../app/ui/primitives";
export { useAutosave } from "../app/ui/autosave/use-autosave";
export { SavedMark, SaveFailed } from "../app/ui/autosave/saved-state";
export { api, errorMessage } from "./client";
export type FieldEntity = "eventType" | "booking" | "availabilityRequest";
export type DetailSlotId = "event-type.settings.after.v1" | "booking.detail.sidebar.after.v1" | "availability-request.detail.after.v1";
export type SettingsContributionId = "operator.settings-section.v1";
export type RouteContributionId = "operator.route.v1";
