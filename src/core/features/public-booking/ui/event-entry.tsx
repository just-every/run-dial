import { ChooseTime } from "./choose-time";
import { RequestOnlyPage } from "./request-only-page";
import type { PublicEventPayload } from "./types";

export function PublicEventEntry({ data, embedded = false, preview = false }: { data: PublicEventPayload; embedded?: boolean; preview?: boolean }) {
  return data.eventType.requestOnly
    ? <RequestOnlyPage data={data} embedded={embedded} />
    : <ChooseTime data={data} embedded={embedded} preview={preview} />;
}
