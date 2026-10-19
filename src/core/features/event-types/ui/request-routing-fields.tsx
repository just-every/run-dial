import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Segmented } from "../../../app/ui/primitives";
import { defaultRequestRouting, type RequestRouting } from "../../../shared/correspondence";

type Operator = { id: string; email: string; status: string };
const modes = [["host_recipients", "Every host"], ["selected", "Selected people"], ["suppressed", "No email"]] as const;
const help: Record<RequestRouting["mode"], string> = {
  host_recipients: "Everyone with access is emailed about each new request for this event type.",
  selected: "Only the people you choose are emailed. Everyone still sees the request in Requests.",
  suppressed: "Nobody is emailed. New requests still appear in Requests and the invitee still gets an acknowledgment.",
};

/** Policy `availability-request.routing.v1`; saved with the event's email settings. */
export function RequestRoutingFields({ value = defaultRequestRouting, disabled, onChange }: { value?: RequestRouting; disabled: boolean; onChange(value: RequestRouting): void }) {
  const [operators, setOperators] = useState<Operator[]>([]), [error, setError] = useState("");
  useEffect(() => {
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
  }, []);
  const chosen = new Set(value.operatorIds);
  function toggle(id: string, checked: boolean) {
    onChange({ mode: "selected", operatorIds: operators.map(operator => operator.id).filter(candidate => candidate === id ? checked : chosen.has(candidate)) });
  }
  return <fieldset className="mt-5 grid min-w-0 gap-3" aria-describedby="request-routing-help">
    <legend className="text-sm font-semibold text-ink">Alternative request email</legend>
    <Segmented label="Who is emailed" name="request-routing" value={value.mode} options={modes} stacked onChange={mode => onChange({ mode, operatorIds: mode === "selected" ? value.operatorIds : [] })} />
    <p id="request-routing-help" className="text-sm leading-6 text-soft">{help[value.mode]}</p>
    {value.mode === "selected" ? <div className="grid min-w-0 gap-2">
      {operators.map(operator => <label key={operator.id} className="flex min-w-0 items-center gap-3 text-sm">
        <input type="checkbox" className="h-6 w-6 shrink-0 accent-ink" checked={chosen.has(operator.id)} disabled={disabled} onChange={event => toggle(operator.id, event.target.checked)} />
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{operator.email}</span>
      </label>)}
      {!chosen.size && operators.length ? <p className="text-sm leading-6 text-danger">Choose at least one person, or choose No email.</p> : null}
    </div> : null}
    {error ? <p role="alert" className="text-sm leading-6 text-danger">{error}</p> : null}
  </fieldset>;
}
