import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Input, noticeClassName } from "../../../app/ui/primitives";

type Settings = { taxEnabled: boolean; businessName: string | null; effectiveBusinessName: string };

/** PAY-005 in the Stripe settings: Stripe Tax for US sales tax, and the business name on receipts and invoices. */
export function TaxSettings() {
  const [settings, setSettings] = useState<Settings>(), [taxEnabled, setTaxEnabled] = useState(false), [businessName, setBusinessName] = useState("");
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const apply = (value: Settings) => { setSettings(value); setTaxEnabled(value.taxEnabled); setBusinessName(value.businessName ?? ""); };
  useEffect(() => {
    void (async () => {
      try { const response = await api.api.app.payments.settings.$get(); if (response.ok) apply(await response.json() as Settings); else setError(await errorMessage(response)); }
      catch { setError("Tax settings could not be loaded. Reload settings to try again."); }
    })();
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setNotice(""); setError("");
    try {
      const response = await api.api.app.payments.settings.$put({ json: { taxEnabled, businessName: businessName.trim() || null } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      apply(await response.json() as Settings); setNotice("Tax and receipt settings saved.");
    } catch { setError("The save result could not be received. Reload settings to check."); }
    finally { setSaving(false); }
  }
  return <form className="mt-5 grid gap-4 border-t border-line-soft pt-5" onSubmit={save} aria-label="Sales tax and receipts">
    <h3 className="text-[15px] font-bold text-ink">Sales tax and receipts</h3>
    <label className="flex items-start gap-3 text-sm text-ink"><input className="mt-0.5 h-[18px] w-[18px]" type="checkbox" checked={taxEnabled} disabled={!settings || saving} onChange={event => { setTaxEnabled(event.target.checked); setNotice(""); }} /><span>Calculate <strong>US sales tax with Stripe Tax</strong>. Invitees enter a billing address, see the tax before they pay and on their receipt; a non-taxable address pays none. Set up Stripe Tax registrations in your Stripe dashboard first.</span></label>
    <label className="grid gap-2 text-sm font-[650] text-ink">Business name on receipts and invoices<Input value={businessName} maxLength={120} placeholder={settings?.effectiveBusinessName ?? ""} disabled={!settings || saving} onChange={event => { setBusinessName(event.target.value); setNotice(""); }} /></label>
    <p className="text-sm leading-6 text-soft">Every payment sends one receipt with this name, the amount, its tax and the Stripe reference to the invitee and the booking's hosts.</p>
    {error ? <p role="alert" className={noticeClassName("error")}>{error}</p> : null}
    {notice ? <p role="status" className={noticeClassName("success")}>{notice}</p> : null}
    <div><Button type="submit" variant="secondary" disabled={!settings || saving}>{saving ? "Saving…" : "Save tax and receipts"}</Button></div>
  </form>;
}
