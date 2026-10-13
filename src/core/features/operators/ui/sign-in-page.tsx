import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, Input, noticeClassName, textLinkClassName } from "../../../app/ui/primitives";
import { MiniDial } from "../../../shared/drawing/MiniDial";
import { BrandMark } from "../../public-booking";

export type SigninOptions = { setup: boolean; local: boolean; developmentOutbox: boolean; setupInstructions: string };

export function SignInPage({ options }: { options: SigninOptions }) {
  const [enhancedReady, setEnhancedReady] = useState(false);
  // Native forms work immediately; this marks when React owns enhanced interactions.
  useEffect(() => { setEnhancedReady(true); }, []);
  const [status, setStatus] = useState("");
  const [localOutbox, setLocalOutbox] = useState(options.developmentOutbox);
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The browser may populate the input before hydration or without a change event.
    const email = new FormData(event.currentTarget).get("email") as string;
    setSubmitting(true); setStatus("");
    const response = await api.api.auth["magic-links"].$post({ json: { email } });
    if (!response.ok) { setStatus(await errorMessage(response)); setSubmitting(false); return; }
    const local = (await response.json()).status === "open_local_outbox";
    setStatus(local ? "Open the local outbox to look for a sign-in link. If it is missing, check operator access and local mail." : "Check your email for a sign-in link. If it does not arrive, ask the install’s operator to check access and mail.");
    setLocalOutbox(local);
    setSubmitting(false);
  }
  return <main data-signin-ready={enhancedReady || undefined} className="grid min-h-screen place-items-center bg-paper px-4 py-10">
    <Card className="w-full max-w-[440px] p-6 sm:rounded-[24px]! sm:p-8">
      <div className="flex items-start justify-between gap-4"><Link to="/" reloadDocument className="inline-flex items-center gap-2 text-[26px] font-extrabold leading-none tracking-[-.02em]"><BrandMark />Dial</Link><MiniDial size={56} className="mini-dial -mt-2" /></div>
      <p className="mt-7 text-xs font-bold uppercase tracking-[.12em] text-muted">Operator access</p>
      <h1 className="mt-2 text-[34px] font-extrabold leading-[1.05] tracking-[-.02em]">Sign in with a magic link.</h1>
      <p className="mt-3 text-[15px] leading-6 text-soft">Enter an allow-listed operator email. Password sign-in is not available.</p>
      <form method="post" action="/auth/magic-link" className="mt-7 grid gap-4" onSubmit={submit}><input type="hidden" name="returnTo" value="/setup" /><label className="grid gap-2 text-sm font-[650]">Email address<Input name="email" type="email" autoComplete="email" required /></label><Button type="submit" className="w-full" disabled={submitting}>{submitting ? "Sending…" : "Send magic link"}</Button></form>
      {status ? <p role="status" className={noticeClassName("success", "mt-5")}>{status}</p> : null}
      {options.setup ? <details className="mt-6 border-t border-line-soft pt-4"><summary className="cursor-pointer text-[15px] font-semibold">Set up the first operator</summary><p className="mt-3 text-sm leading-6 text-soft">{options.setupInstructions}{options.local ? null : " SETUP_TOKEN is the value supplied to the deploy step."} The operator email is the address configured during setup.</p><form method="post" action="/auth/bootstrap" className="mt-4 grid gap-3"><label className="grid gap-2 text-sm font-[650]">Your name<Input name="displayName" autoComplete="name" required maxLength={120} /></label><label className="grid gap-2 text-sm font-[650]">Setup token<Input name="token" type="password" autoComplete="off" required /></label><input type="hidden" name="returnTo" value="/setup" /><Button type="submit">Complete setup</Button></form></details> : null}
      <div className="mt-6 grid justify-items-start gap-3 text-[15px]">{localOutbox ? <a className={textLinkClassName} href="/__dev/outbox">Open local outbox</a> : null}<Link to="/" reloadDocument className={textLinkClassName}>Return to the public landing</Link></div>
    </Card>
  </main>;
}
