import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Segmented } from "../../../app/ui/primitives";
import { SavedMark } from "../../../app/ui/autosave/saved-state";
import type { FieldState } from "../../../app/ui/autosave/use-autosave";
import { defaultRequestRouting, type RequestRouting } from "../../../shared/correspondence";

type Operator = { id: string; email: string; status: string };
const modes = [["host_recipients", "Every host"], ["selected", "Selected people"], ["suppressed", "No email"]] as const;


/** Policy `availability-request.routing.v1`; saved with the event's email settings. */
export function RequestRoutingFields({ value = defaultRequestRouting, disabled, onChange, operators: initialOperators, state }: { value?: RequestRouting; disabled: boolean; operators?: Operator[]; onChange(value: RequestRouting): void; state?: FieldState }) {
  const [operators, setOperators] = useState<Operator[]>(initialOperators?.filter(operator => operator.status === "active") ?? []), [error, setError] = useState("");
  useEffect(() => {
    if (initialOperators) return;
    let active = true;
    void (async () => {
      try {
        const response = await api.api.app.operators.$get();
        if (!response.ok) throw new Error(await errorMessage(response));
        const result = await response.json();
        if (active) setOperators(result.operators.filter(operator => operator.status === "active"));
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "People with access could not be loaded."); }
    })();
    return () => { active = false; };
  }, [initialOperators]);
  const chosen = new Set(value.operatorIds);
  function toggle(id: string, checked: boolean) {
    onChange({ mode: "selected", operatorIds: operators.map(operator => operator.id).filter(candidate => candidate === id ? checked : chosen.has(candidate)) });
  }
  return <fieldset className="mt-5 grid min-w-0 gap-3">
    <legend className="w-full text-sm font-semibold text-ink"><span className="flex items-center justify-between gap-2">Alternative request email{state ? <SavedMark state={state} /> : null}</span></legend>
    <Segmented label="Who is emailed" name="request-routing" value={value.mode} options={modes} stacked onChange={mode => onChange({ mode, operatorIds: mode === "selected" ? value.operatorIds : [] })} />
    {value.mode === "selected" ? <div className="grid min-w-0 gap-2">
      {operators.map(operator => <label key={operator.id} className="flex min-h-11 min-w-0 items-center gap-3 text-sm">
        <input type="checkbox" className="h-6 w-6 shrink-0 accent-ink" checked={chosen.has(operator.id)} disabled={disabled} onChange={event => toggle(operator.id, event.target.checked)} />
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{operator.email}</span>
      </label>)}
      {!chosen.size && operators.length ? <p className="text-sm leading-6 text-danger">Choose at least one person, or choose No email.</p> : null}
    </div> : null}
    {error ? <p role="alert" className="text-sm leading-6 text-danger">{error}</p> : null}
  </fieldset>;
}
