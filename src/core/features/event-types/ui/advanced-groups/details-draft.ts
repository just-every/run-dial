import { useEffect, useRef, useState } from "react";
import { guard } from "../../../../app/ui/autosave/leave-guard";
import { useAutosave, type Write } from "../../../../app/ui/autosave/use-autosave";
import { eventDetailsInputSchema } from "../../event-input";
import type { EventDetailsInput } from "../../repository";

type Field = keyof EventDetailsInput;
type Draft = Partial<EventDetailsInput>;
const stagedFields: Field[] = ["title", "locations", "questions", "postBookingRedirect"];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Keep incomplete items on screen, while complete neighbours can save independently. */
function completeDetails(values: EventDetailsInput, saved: EventDetailsInput) {
  const next = { ...values };
  for (let attempt = 0; attempt <= Object.keys(next).length; attempt++) {
    const result = eventDetailsInputSchema.safeParse(next);
    if (result.success) return next;
    const before = JSON.stringify(next);
    for (const issue of result.error.issues) {
      const field = issue.path[0] as Field;
      if ((field === "locations" || field === "questions") && typeof issue.path[1] === "number") {
        // Apply all item failures together below, so removing one never shifts another's index.
        const bad = new Set(result.error.issues.filter(entry => entry.path[0] === field).map(entry => entry.path[1]));
        if (field === "locations") next.locations = values.locations?.flatMap((item, position) => !bad.has(position) ? [item] : saved.locations?.filter(old => old.id === item.id) ?? []);
        else next.questions = values.questions.flatMap((item, position) => !bad.has(position) ? [item] : saved.questions.filter(old => old.key === item.key));
      } else if (stagedFields.includes(field)) Object.assign(next, { [field]: saved[field] });
    }
    if (before === JSON.stringify(next)) break;
  }
  // Other invalid fields remain here for the full schema check in the writer.
  return next;
}

function missing(values: EventDetailsInput, field: Field) {
  const parsed = eventDetailsInputSchema.safeParse(values);
  if (parsed.success) return undefined;
  const issue = parsed.error.issues.find(entry => entry.path[0] === field);
  if (!issue) return undefined;
  if (field === "title") return "Give the event a name.";
  if (field === "questions") return values.questions.some(question => !question.label.trim()) ? "Write the question." : issue.message;
  if (field === "postBookingRedirect") return "Add the page to send invitees to.";
  if (field === "locations") {
    const location = values.locations?.[Number(issue.path[1])];
    if (!location?.label.trim()) return "Add the public label.";
    return location.type === "fixed_link" ? "Add the meeting link." : location.type === "phone" ? "Add the phone number." : location.type === "ask_invitee" ? "Add the invitee prompt." : location.type === "custom" ? "Add the instruction." : "Add the address.";
  }
  return issue.message;
}

export function useDetailsDraft(key: string, initial: EventDetailsInput, write: Write<EventDetailsInput>, asks: Field[]) {
  const saved = useRef(initial);
  const draftRef = useRef<Draft>({});
  const [draft, setDraft] = useState<Draft>({});
  const [left, setLeft] = useState<Set<Field>>(new Set());
  const save = useAutosave(key, initial, async (next, init) => {
    const parsed = eventDetailsInputSchema.parse(completeDetails({ ...next, ...draftRef.current }, saved.current)) as EventDetailsInput;
    await write(parsed, init);
    saved.current = parsed;
  }, { asks });
  const values = { ...save.values, ...draft };
  const current = useRef({ values, draft });
  current.current = { values, draft };
  useEffect(() => guard({
    key: `${key}:incomplete`, mounted: 1,
    flush: async () => {
      const fields = Object.keys(current.current.draft) as Field[];
      setLeft(previous => new Set([...previous, ...fields]));
      return fields.length === 0;
    },
    sendOnHide: () => undefined,
  }), [key]);
  function change<K extends Field>(field: K, value: EventDetailsInput[K], choice: boolean) {
    const raw = { ...current.current.values, [field]: value };
    const complete = completeDetails(raw, saved.current);
    const pending = { ...current.current.draft };
    for (const name of stagedFields) {
      if (!same(raw[name], complete[name])) Object.assign(pending, { [name]: raw[name] });
      else delete pending[name];
    }
    current.current = { values: raw, draft: pending };
    draftRef.current = pending;
    setDraft(pending);
    setLeft(previous => new Set([...previous].filter(name => name !== field)));
    (choice ? save.choose : save.type)(field, complete[field]);
  }
  return {
    ...save, values, savedValues: saved.current,
    type: <K extends Field>(field: K, value: EventDetailsInput[K]) => change(field, value, false),
    choose: <K extends Field>(field: K, value: EventDetailsInput[K]) => change(field, value, true),
    leave: (field?: Field | unknown) => {
      if (typeof field === "string") setLeft(previous => new Set([...previous, field as Field]));
      save.leave();
    },
    validation: (field: Field) => left.has(field) ? missing(values, field) : undefined,
    keep: (field: Field) => {
      const pending = { ...current.current.draft };
      delete pending[field];
      current.current = { values: { ...current.current.values, [field]: saved.current[field] }, draft: pending };
      draftRef.current = pending;
      setDraft(pending);
      save.keep(field);
    },
    state: (field: Field) => draft[field] !== undefined ? { ...save.state(field), saved: false } : save.state(field),
  };
}
