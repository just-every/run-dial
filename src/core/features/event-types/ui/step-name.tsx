import { Input, Textarea } from "../../../app/ui/primitives";

export function StepName({ name, description, onName, onDescription }: { name: string; description: string; onName(value: string): void; onDescription(value: string): void }) {
  return <div className="grid gap-4">
    <label className="grid gap-2 text-sm font-semibold">Name<Input name="name" required maxLength={160} value={name} onChange={event => onName(event.target.value)} /></label>
    <label className="grid gap-2 text-sm font-semibold"><span>Description <span className="font-normal text-soft">(optional)</span></span><Textarea aria-label="Description" maxLength={4000} rows={3} value={description} onChange={event => onDescription(event.target.value)} /></label>
  </div>;
}
