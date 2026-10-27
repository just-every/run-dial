import type { ComponentType } from "react";
import type { DetailSlotId, SettingsContributionId, FieldEntity } from "../api/extensions";
import { CustomFieldSettings, CustomFieldDetail } from "../../ext/ui";
/** Static composition by declared IDs. Public documents never mount this registry. */
const contributions: Record<SettingsContributionId, ComponentType> = {
  "operator.settings-section.v1": CustomFieldSettings,
};
const slots: Record<DetailSlotId, {entity:FieldEntity; component:typeof CustomFieldDetail}> = {
  "event-type.settings.after.v1": {entity:"eventType", component:CustomFieldDetail},
  "booking.detail.sidebar.after.v1": {entity:"booking", component:CustomFieldDetail},
  "availability-request.detail.after.v1": {entity:"availabilityRequest", component:CustomFieldDetail},
};
export function ExtensionContribution({id}:{id:SettingsContributionId}) { const Component = contributions[id];return <Component />; }
export function ExtensionSlot({id,entityId,autosave=false,onSaved}:{id:DetailSlotId;entityId:string;autosave?:boolean;onSaved?():void}) { const slot = slots[id];const Component=slot.component;return <Component entity={slot.entity} id={entityId} autosave={autosave} onSaved={onSaved} />; }
