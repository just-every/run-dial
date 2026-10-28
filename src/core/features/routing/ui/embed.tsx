import { useState } from 'react';
import { Select, Textarea } from '../../../app/ui/primitives';
import { routingEmbedSnippet } from '../../embeds/client';

export function FormEmbed({ publicOrigin, slug }: { publicOrigin: string; slug: string }) {
  const [mode, setMode] = useState<'inline' | 'modal'>('inline');
  const snippet = routingEmbedSnippet(publicOrigin, slug, mode);
  return <section className="grid min-w-0 gap-4 border-t border-line pt-5 text-[15px]">
    <h3 className="text-lg font-semibold">Embed this routing form</h3>
    <p className="text-soft">Add the code to your website. First allow your website’s origin in <a href="/app/settings" className="underline">embed settings</a>.</p>
    <label className="grid gap-2">Embed style
      <Select value={mode} onChange={event => setMode(event.target.value as 'inline' | 'modal')}>
        <option value="inline">Inline form</option>
        <option value="modal">Modal opened by a button</option>
      </Select>
    </label>
    <label className="grid gap-2">Website embed code
      <Textarea readOnly value={snippet} rows={6} spellCheck={false} className="font-mono text-[13px]" onFocus={event => event.currentTarget.select()} />
    </label>
    <p className="text-[13px] text-soft">Select the code to copy it, then paste it into your website’s HTML.</p>
  </section>;
}
