import { useEffect, useRef, useState } from "react";
import { guard } from "../../../../app/ui/autosave/leave-guard";
import { useAutosave, type Write } from "../../../../app/ui/autosave/use-autosave";
import { offeredLocations } from "../../locations";
import { eventDetailsInputSchema } from "../../event-input";
import type { EventDetailsInput } from "../../repository";
import { plainProblem } from "./details-problems";

type Field = keyof EventDetailsInput;
type Draft = Partial<EventDetailsInput>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Keep incomplete fields and items on screen, while complete neighbours can save independently. */
function completeDetails(values: EventDetailsInput, saved: EventDetailsInput) {
  const next = { ...values };
  for (let attempt = 0; attempt <= Object.keys(next).length; attempt++) {
    const result = eventDetailsInputSchema.safeParse(next);
    if (result.success) {
      if (same(next.locations, offeredLocations(saved))) next.locations = saved.locations;
      return next;
    }
    const before = JSON.stringify(next);
    for (const issue of result.error.issues) {
      const field = issue.path[0] as Field;
      if ((field === "locations" || field === "questions") && typeof issue.path[1] === "number") {
        // Apply all item failures together below, so removing one never shifts another's index.
        const bad = new Set(result.error.issues.filter(entry => entry.path[0] === field).map(entry => entry.path[1]));
        if (field === "locations") next.locations = values.locations?.flatMap((item, position) => !bad.has(position) ? [item] : saved.locations?.filter(old => old.id === item.id) ?? []);
        else next.questions = values.questions.flatMap((item, position) => !bad.has(position) ? [item] : saved.questions.filter(old => old.key === item.key));
      } else if (typeof field === "string" && field in saved) Object.assign(next, { [field]: saved[field] });
    }
    if (before === JSON.stringify(next)) break;
  }
  // What no saved value can repair (a rule between two fields) stays here for the writer to name.
  return next;
}

function failing(values: EventDetailsInput) {
  const parsed = eventDetailsInputSchema.safeParse(values);
  return parsed.success ? [] : parsed.error.issues;
}

function missing(values: EventDetailsInput, field: Field) {
  const issue = failing(values).find(entry => entry.path[0] === field);
  return issue ? describe(values, field, issue) : undefined;
}

function describe(values: EventDetailsInput, field: Field, issue: ReturnType<typeof failing>[number]) {
  if (field === "title") return "Give the event a name.";
  if (field === "questions") return values.questions.some(question => !question.label.trim()) ? "Write the question." : issue.path[2] === "options" && typeof issue.path[3] === "number" ? "Fill in each choice’s label and what it is saved as." : plainProblem(field, issue);
  if (field === "postBookingRedirect") return "Add the page to send invitees to.";
  if (field === "locations") {
    const location = values.locations?.[Number(issue.path[1])];
    if (!location?.label.trim()) return "Add the public label.";
    return location.type === "fixed_link" ? "Add the meeting link." : location.type === "phone" ? "Add the phone number." : location.type === "ask_invitee" ? "Add the invitee prompt." : location.type === "custom" ? "Add the instruction." : "Add the address.";
  }
  return plainProblem(field, issue);
}

export function useDetailsDraft(key: string, initial: EventDetailsInput, write: Write<EventDetailsInput>, asks: Field[]) {
  const saved = useRef(initial);
  const draftRef = useRef<Draft>({});
  const [local, setLocal] = useState<{ draft: Draft; savedValues: EventDetailsInput }>({ draft: {}, savedValues: initial });
  const { draft, savedValues } = local;
  const setDraft = (pending: Draft) => setLocal(previous => ({ ...previous, draft: pending }));
  const [left, setLeft] = useState<Set<Field>>(new Set());
  const save = useAutosave(key, initial, async (next, init) => {
    const complete = completeDetails({ ...next, ...draftRef.current }, saved.current);
    const issue = failing(complete)[0];
    if (issue) throw new Error(describe(complete, issue.path[0] as Field, issue));
    const parsed = eventDetailsInputSchema.parse(complete) as EventDetailsInput;
    await write(parsed, init);
    saved.current = parsed;
    setLocal(previous => ({ ...previous, savedValues: parsed }));
  }, { asks });
  const values = { ...save.values, ...draft };
  const current = useRef({ values, draft });
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
    const raw = { ...save.values, ...current.current.draft, [field]: value };
    const complete = completeDetails(raw, saved.current);
    const pending = { ...current.current.draft };
    const incomplete = new Set(failing(raw).map(issue => issue.path[0]));
    for (const name of Object.keys(raw) as Field[]) {
      if (incomplete.has(name)) Object.assign(pending, { [name]: raw[name] });
      else delete pending[name];
    }
    current.current = { values: raw, draft: pending };
    draftRef.current = pending;
    setDraft(pending);
    setLeft(previous => new Set([...previous].filter(name => name !== field)));
    (choice ? save.choose : save.type)(field, complete[field]);
  }
  return {
    ...save, values, savedValues,
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
