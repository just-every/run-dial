import { CorrespondenceEditor } from "../correspondence-editor";
import type { CorrespondenceConfig } from "../../../../shared/correspondence";
import type { EventTypeRecord } from "../../repository";
export function EmailsAndCalendarInvite({ event, correspondence, operators, hostName, onSaved }: { event: EventTypeRecord; correspondence: CorrespondenceConfig; operators: { id: string; email: string; status: string }[]; hostName: string; onSaved(): void }) {
  return <CorrespondenceEditor eventId={event.id} initial={correspondence} operators={operators} hostName={hostName} eventTitle={event.title} questions={event.questions} onSaved={onSaved} />;
}
