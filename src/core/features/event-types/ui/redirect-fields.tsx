import { Card, Input } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { redirectFields } from "../redirect-policy.mjs";
import type { EventQuestionInput, PostBookingRedirect } from "../repository";

const labels: Record<string, string> = {
  event: "Event name", start_time: "Start time", end_time: "End time", timezone: "Invitee timezone",
  host: "Assigned host name", name: "Invitee name", email: "Invitee email", booking_reference: "Booking reference",
  utm_source: "UTM source", utm_medium: "UTM medium", utm_campaign: "UTM campaign", utm_term: "UTM term", utm_content: "UTM content", source: "Custom source",
};

export function RedirectFields({ value, questions, onChange }: { value?: PostBookingRedirect | null; questions: EventQuestionInput[]; onChange(value: PostBookingRedirect | null): void }) {
  const choices = [...redirectFields.map(field => ({ field, label: labels[field] })), ...questions.flatMap(question => question.key && !question.private ? [{ field: `answer.${question.key}`, label: `Answer: ${question.label}` }] : [])];
  function toggle(field: string, checked: boolean) {
    if (value) onChange({ ...value, fields: checked ? [...value.fields, field] : value.fields.filter(entry => entry !== field) });
  }
  return <Card className="p-5 sm:p-6">
    <SectionHeading icon="link" title="After booking" description="Send invitees to your own page after their booking confirms. Their confirmation email still includes the manage link." />
    <label className="mt-5 flex items-center gap-3 text-sm font-[650]"><input className="h-[18px] w-[18px]" type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.target.checked ? { url: "", fields: [] } : null)} /> Redirect after booking</label>
    {value ? <div className="mt-4 grid gap-4">
      <label className="grid gap-2 text-sm font-[650]">Redirect URL<Input type="url" required pattern="https://.*" maxLength={4096} placeholder="https://example.com/thank-you" value={value.url} onChange={event => onChange({ ...value, url: event.target.value })} /></label>
      <fieldset className="grid gap-3 border-0 p-0 sm:grid-cols-2"><legend className="mb-3 text-sm font-[650]">Booking fields to append</legend>{choices.map(({ field, label }) => <label key={field} className="flex items-center gap-2 text-sm"><input className="h-[18px] w-[18px]" type="checkbox" checked={value.fields.includes(field)} onChange={event => toggle(field, event.target.checked)} />{label}</label>)}</fieldset>
      <p className="text-sm text-soft">Only selected fields are shared with this page. Questions excluded from redirects cannot be selected.</p>
    </div> : null}
  </Card>;
}
