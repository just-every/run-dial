import { FollowUpSettingsCard } from "../features/follow-ups/ui/settings";
import { FollowUpHistoryCard } from "../features/follow-ups/ui/history";
import type { ComponentProps, ComponentType } from "react";
import type { DetailSlotId, SettingsContributionId, FieldEntity } from "../api/extensions";
import { CustomFieldSettings, CustomFieldDetail } from "../../ext/ui";
/** Static composition by declared IDs. Public documents never mount this registry. */
const contributions: Record<SettingsContributionId, ComponentType> = {
  "operator.settings-section.v1": CustomFieldSettings,
};
const slots: Record<DetailSlotId, {entity:FieldEntity; component:typeof CustomFieldDetail}> = {
  "event-type.settings.after.v1": {entity:"eventType", component:EventSettingsContributions},
  "booking.detail.sidebar.after.v1": {entity:"booking", component:BookingContributions},
  "availability-request.detail.after.v1": {entity:"availabilityRequest", component:CustomFieldDetail},
};
export function ExtensionContribution({id}:{id:SettingsContributionId}) { const Component = contributions[id];return <Component />; }
export function ExtensionSlot({id,entityId}:{id:DetailSlotId;entityId:string}) { const slot = slots[id];const Component=slot.component;return <Component entity={slot.entity} id={entityId} />; }

function EventSettingsContributions(props: ComponentProps<typeof CustomFieldDetail>) { return <><FollowUpSettingsCard eventId={props.id} /><CustomFieldDetail {...props} /></>; }
function BookingContributions(props: ComponentProps<typeof CustomFieldDetail>) { return <><FollowUpHistoryCard bookingId={props.id} /><CustomFieldDetail {...props} /></>; }
