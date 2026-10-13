import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, Input, Select } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import type { BlockedAddressRule } from "../index";

export function BlockedAddressesCard() {
  const [rules, setRules] = useState<BlockedAddressRule[]>([]);
  const [kind, setKind] = useState<BlockedAddressRule["kind"]>("email");
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await api.api.app["blocked-addresses"].$get();
    if (!response.ok) throw new Error(await errorMessage(response));
    setRules((await response.json()).rules);
    setReady(true);
  }
  useEffect(() => { void load().catch(() => setError("Blocking rules could not be loaded. Reload them to retry.")); }, []);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || working) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await api.api.app["blocked-addresses"].$post({ json: { kind, value } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      const rule = await response.json() as BlockedAddressRule;
      setRules((current) => current.some((entry) => entry.id === rule.id) ? current : [...current, rule]);
      setValue(""); setNotice("Blocking rule saved.");
    } catch { setError("The result could not be received. Your entry is kept; reload the rules or retry."); }
    finally { setWorking(false); }
  }

  async function remove(id: string) {
    if (working) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await api.api.app["blocked-addresses"][":id"].$delete({ param: { id } });
      if (!response.ok && response.status !== 404) { setError(await errorMessage(response)); return; }
      setRules((current) => current.filter((rule) => rule.id !== id));
      setNotice("Blocking rule removed.");
    } catch { setError("The result could not be received. Reload the rules before trying again."); }
    finally { setWorking(false); }
  }

  async function reload() {
    setWorking(true); setError("");
    try { await load(); } catch { setError("Blocking rules could not be loaded. Please retry."); }
    finally { setWorking(false); }
  }

  return <Card className="p-5 sm:p-6 xl:col-span-2">
    <SectionHeading icon="shield" title="Blocked addresses" />
    <p className="mt-2 max-w-2xl text-sm leading-6 text-soft">Block new bookings and requests from an email address or exact domain; subdomains and existing records are unaffected.</p>
    <p className="mt-2 text-sm leading-6 text-soft">Erasing a person’s last booking or request removes their email rule. Remove domain rules here.</p>
    {error ? <p role="alert" className="mt-4 rounded-[14px] bg-danger-wash p-3 text-sm leading-6 text-danger">{error}</p> : null}
    {notice ? <p role="status" className="mt-4 rounded-[14px] bg-gold-wash p-3 text-sm text-ink">{notice}</p> : null}
    <form className="mt-5" onSubmit={(event) => void add(event)}>
      <fieldset disabled={!ready || working} className="grid gap-3 sm:grid-cols-[12rem_1fr_auto]">
        <label className="grid gap-2 text-sm font-[650] text-ink">Rule type<Select value={kind} onChange={(event) => { setKind(event.target.value as BlockedAddressRule["kind"]); }}><option value="email">Email address</option><option value="domain">Domain</option></Select></label>
        <label className="grid gap-2 text-sm font-[650] text-ink">{kind === "email" ? "Email address to block" : "Domain to block"}<Input type={kind === "email" ? "email" : "text"} value={value} onChange={(event) => { setValue(event.target.value); }} required maxLength={kind === "email" ? 320 : 253} placeholder={kind === "email" ? "person@example.com" : "example.com"} /></label>
        <Button type="submit" className="self-end">{working ? "Saving…" : "Add rule"}</Button>
      </fieldset>
    </form>
    <div className="mt-5 grid gap-2">
      {rules.map((rule) => <div key={rule.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-row px-4 py-3"><div className="min-w-0 flex-1"><p className="break-all text-sm font-semibold">{rule.value}</p><p className="text-[13px] text-muted">{rule.kind === "email" ? "Email address" : "Exact domain"}</p></div><Button type="button" variant="secondary" disabled={working} aria-label={`Remove blocking rule for ${rule.value}`} onClick={() => void remove(rule.id)}>Remove</Button></div>)}
      {ready && rules.length === 0 ? <p className="text-sm text-muted">No addresses or domains are blocked.</p> : null}
      {!ready && !error ? <p role="status" className="text-sm text-muted">Loading blocking rules…</p> : null}
    </div>
    {error ? <Button type="button" variant="quiet" className="mt-4" disabled={working} onClick={() => void reload()}>Reload rules</Button> : null}
  </Card>;
}
