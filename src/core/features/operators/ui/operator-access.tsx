import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, Input, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";

type Operator = { id: string; email: string; setupOperator: boolean; status: "active" | "invited" | "inactive" };
export function OperatorAccessCard() {
  const inviteButton = useRef<HTMLButtonElement>(null);
  const focusAfterRemoval = useRef(false);
  const removalOpener = useRef<HTMLButtonElement | null>(null);
  const [operators, setOperators] = useState<Operator[]>();
  const [currentId, setCurrentId] = useState("");
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<Operator>();
  useEffect(() => { if (!working && focusAfterRemoval.current) { inviteButton.current?.focus(); focusAfterRemoval.current = false; } }, [working]);
  async function load() {
    const response = await api.api.app.operators.$get();
    if (!response.ok) throw new Error(await errorMessage(response));
    const data = await response.json();
    setOperators(data.operators); setCurrentId(data.currentOperatorId);
  }
  useEffect(() => { void load().catch((reason: Error) => setError(reason.message)); }, []);
  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (working) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await api.api.app.operators.$post({ json: { email } });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result = await response.json();
      setEmail("");
      setNotice(result.invitation === "queued" ? "Operator added. A sign-in link was sent." : "Operator added, but the sign-in email could not be sent. Check the mail connection, then ask them to sign in.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The result could not be received. Reload operators before retrying."); }
    finally { setWorking(false); }
  }
  async function remove() {
    if (!removing || working) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await api.api.app.operators[":id"].remove.$post({ param: { id: removing.id } });
      if (!response.ok) throw new Error(await errorMessage(response));
      if (removing.id === currentId) { window.location.assign("/signin"); return; }
      setRemoving(undefined); setNotice("Operator identity and local mail erased. Authored records are preserved anonymously."); await load(); focusAfterRemoval.current = true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The result could not be received. Reload operators before retrying."); }
    finally { setWorking(false); }
  }
  return <Card className="p-5 sm:p-6 xl:col-span-2">
    <SectionHeading icon="people" title="Operator access" />
    <p className="mt-3 text-sm leading-6 text-soft">Every operator has equal access. Removal erases their identity, sessions, private links and local mail. Authored records remain anonymous and the shared calendar stays connected. Erase matching invitee bookings and requests from their detail pages before removing an operator.</p>
    {error ? <p role="alert" className={noticeClassName("error", "mt-3")}>{error}</p> : null}
    {notice ? <p role="status" className={noticeClassName("success", "mt-3")}>{notice}</p> : null}
    {!operators && !error ? <p className="mt-4">Loading operators…</p> : null}
    {error ? <Button type="button" variant="secondary" className="mt-3" disabled={working} onClick={() => { setError(""); setRemoving(undefined); void load().catch((reason: Error) => setError(reason.message)); }}>Reload operators</Button> : null}
    <ul className="mt-5 grid gap-3">{operators?.map((operator) => <li key={operator.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-row px-4 py-3.5">
      <div className="min-w-0 break-all text-sm"><span className="font-semibold">{operator.email}</span><p className="text-muted">{operator.setupOperator ? "Setup operator" : "Operator"}{operator.id === currentId ? " · You" : ""}{operator.status === "inactive" ? " · Access revoked; erasure incomplete" : ""}</p></div>
      <Button type="button" variant="danger" disabled={working || operators.length === 1 || (operator.setupOperator || operator.id === currentId)} onClick={(event) => { removalOpener.current = event.currentTarget; setRemoving(operator); }} aria-label={`Remove ${operator.email}`}>Remove</Button>
    </li>)}</ul>
    {operators?.length === 1 ? <p className="mt-3 text-sm text-muted">Your own identity and the setup owner are protected. Owner transfer is required before erasing the setup owner.</p> : null}
    {removing ? <div className="mt-5 rounded-[14px] border border-danger-line bg-danger-wash p-4 text-ink"><p className="break-words text-sm font-semibold">Remove access for {removing.email}?</p><p className="mt-2 text-sm">Their identity and local mail will be erased, and their sessions and unused sign-in links will stop working.</p><div className="mt-3 flex flex-wrap gap-3"><Button type="button" variant="danger" disabled={working} onClick={() => void remove()}>Confirm removal</Button><Button type="button" variant="secondary" disabled={working} onClick={() => { setRemoving(undefined); removalOpener.current?.focus(); }}>Keep access</Button></div></div> : null}
    <form className="mt-6 grid gap-3 border-t border-line-soft pt-5 sm:grid-cols-[1fr_auto]" onSubmit={(event) => void invite(event)}>
      <label className="grid gap-2 text-sm font-[650]">Operator email<Input type="email" autoComplete="email" maxLength={320} required value={email} onChange={(event) => setEmail(event.target.value)} disabled={working || !operators} /></label>
      <Button ref={inviteButton} type="submit" className="self-end" disabled={working || !operators}>{working ? "Saving…" : "Invite operator"}</Button>
    </form>
  </Card>;
}
