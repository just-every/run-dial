export function DurationChoice({ options, selected, disabled, onChange }: { options: number[]; selected: number; disabled: boolean; onChange: (duration: number) => void }) {
  if (options.length < 2) return null;
  return <div className="pb-duration-options" role="group" aria-label="Meeting duration"><p>Duration</p><div>{options.map(duration => <button type="button" key={duration} className="pb-secondary-button" aria-pressed={duration === selected} disabled={disabled} onClick={() => onChange(duration)}>{duration} minutes</button>)}</div></div>;
}
