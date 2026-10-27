import { useEffect, useRef, useState, type ReactNode } from "react";
import { Card, IconTile } from "../../../app/ui/primitives";
import { ExtensionSlot } from "../../../app/extensions";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import type { IconName } from "../../../shared/drawing/icons";
import type { EventPrice } from "../../../shared/event-price";
import type { PaymentTerms } from "../../../shared/payment-terms";
import type { EventBookingPolicy } from "../../../shared/booking-policy";
import type { CorrespondenceConfig } from "../../../shared/correspondence";
import type { EventTypeRecord } from "../repository";
import type { EventDetailsSave } from "./event-page-context";
import { PriceAndPayment } from "./advanced-groups/price-and-payment";
import { Questions } from "./advanced-groups/questions";
import { GuestsAndApproval } from "./advanced-groups/guests-and-approval";
import { ChangesAndCancellations } from "./advanced-groups/changes-and-cancellations";
import { EmailsAndCalendarInvite } from "./advanced-groups/emails-and-calendar-invite";
import { TimeZone } from "./advanced-groups/time-zone";
import { AfterBooking } from "./advanced-groups/after-booking";
import { AddressAndListing } from "./advanced-groups/address-and-listing";
import { readSetting, SettingReadState } from "../../../app/ui/autosave-setting";
import "./advanced-sheet.css";

type Data = { price: EventPrice; terms: PaymentTerms; guests: { guestLimit: number }; approval: { required: boolean; windowHours: number }; policy: EventBookingPolicy; correspondence: CorrespondenceConfig; operators: { operators: { id: string; email: string; status: string }[] }; fields: { id: string }[] };
type Props = { event: EventTypeRecord; details: EventDetailsSave; onSaved(): void; hostName: string; hostTimezone: string };

/** The event's existing reads run together. Folding a group keeps its form mounted. */
export function AdvancedSettings(props: Props) {
  const prefix = `/api/app/event-types/${props.event.id}`;
  const initialPrice = useWorkspaceRead<EventPrice>(`${prefix}/price`);
  const initialTerms = useWorkspaceRead<PaymentTerms>(`${prefix}/payment-terms`);
  const initialGuests = useWorkspaceRead<Data["guests"]>(`${prefix}/guests`);
  const initialApproval = useWorkspaceRead<Data["approval"]>(`${prefix}/approval`);
  const initialPolicy = useWorkspaceRead<EventBookingPolicy>(`${prefix}/booking-policy`);
  const initialCorrespondence = useWorkspaceRead<CorrespondenceConfig>(`${prefix}/correspondence`);
  const initialOperators = useWorkspaceRead<Data["operators"]>("/api/app/operators");
  const [data, setData] = useState<Data>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([
      initialPrice ?? readSetting<EventPrice>(`${prefix}/price`), initialTerms ?? readSetting<PaymentTerms>(`${prefix}/payment-terms`),
      initialGuests ?? readSetting<Data["guests"]>(`${prefix}/guests`), initialApproval ?? readSetting<Data["approval"]>(`${prefix}/approval`),
      initialPolicy ?? readSetting<EventBookingPolicy>(`${prefix}/booking-policy`), initialCorrespondence ?? readSetting<CorrespondenceConfig>(`${prefix}/correspondence`),
      initialOperators ?? readSetting<Data["operators"]>("/api/app/operators"), readSetting<Data["fields"]>(`/api/app/custom-fields/eventType/${props.event.id}`),
    ]).then(([price, terms, guests, approval, policy, correspondence, operators, fields]) => { if (active) { setData({ price, terms, guests, approval, policy, correspondence, operators, fields }); setError(""); } }).catch(() => { if (active) setError("Advanced settings could not be loaded."); });
    return () => { active = false; };
  }, [prefix, props.event.id, initialPrice, initialTerms, initialGuests, initialApproval, initialPolicy, initialCorrespondence, initialOperators, attempt]);
  return data ? <AdvancedGroups {...props} data={data} /> : <SettingReadState error={error} retry={() => setAttempt(value => value + 1)} />;
}
function AdvancedGroups({ event, details, onSaved, hostName, hostTimezone, data }: Props & { data: Data }) {
  const [open, setOpen] = useState<string>();
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(data);
  const summaryEpoch = useRef(0);
  useEffect(() => () => { summaryEpoch.current++; }, []);
  async function updated() {
    onSaved();
    const epoch = ++summaryEpoch.current;
    // Only summaries take the fresh read; mounted forms retain their own save state and focus.
    const prefix = `/api/app/event-types/${event.id}`;
    try {
      const [price, terms, guests, approval, policy, correspondence] = await Promise.all([readSetting<EventPrice>(`${prefix}/price`), readSetting<PaymentTerms>(`${prefix}/payment-terms`), readSetting<Data["guests"]>(`${prefix}/guests`), readSetting<Data["approval"]>(`${prefix}/approval`), readSetting<EventBookingPolicy>(`${prefix}/booking-policy`), readSetting<CorrespondenceConfig>(`${prefix}/correspondence`)]);
      if (epoch === summaryEpoch.current) setCurrent(value => ({ ...value, price, terms, guests, approval, policy, correspondence }));
    } catch { /* A save succeeded; its own field remains authoritative until the next read. */ }
  }
  const changed = { eventId: event.id, hostTimezone, onSaved: updated };
  const eventValues = { ...event, ...details.values };
  const policy = current.policy;
  const changes = policy.rescheduleCutoffMinutes === null && policy.cancellationCutoffMinutes === null ? "Uses your usual reschedule and cancellation rules" : policy.rescheduleCutoffMinutes === 0 && policy.cancellationCutoffMinutes === 0 ? "Invitees can reschedule or cancel up to the start" : `Reschedule: ${cutoff(policy.rescheduleCutoffMinutes)} · cancel: ${cutoff(policy.cancellationCutoffMinutes)}`;
  const groups: { name: string; icon: IconName; summary: string; content: ReactNode }[] = [
    { name: "Price and payment", icon: "notice", summary: `${priceSummary(current.price)} · ${current.terms.deposit.kind === "none" ? "no deposit" : "deposit set"}${current.terms.lateCancelFeeCents || current.terms.noShowFeeCents ? " · fees set" : " or fees"}`, content: <PriceAndPayment event={eventValues} price={data.price} terms={data.terms} onSaved={updated} /> },
    { name: "Questions", icon: "message", summary: details.values.questions.length ? `${details.values.questions.length} question${details.values.questions.length === 1 ? "" : "s"}: ${details.values.questions.map(question => question.label).join(", ")}` : "Name and email only", content: <Questions details={details} /> },
    { name: "Guests and approval", icon: "people", summary: `${current.guests.guestLimit ? `Up to ${current.guests.guestLimit} guests` : "No guests"} · ${current.approval.required ? `approval within ${current.approval.windowHours} hours` : "bookings confirm without approval"}`, content: <GuestsAndApproval eventId={event.id} guests={data.guests} approval={data.approval} onSaved={updated} /> },
    { name: "Changes and cancellations", icon: "restore", summary: changes, content: <ChangesAndCancellations {...changed} policy={data.policy} /> },
    { name: "Emails and calendar invite", icon: "mail", summary: `${Object.values(current.correspondence.templates).some(value => value !== null) ? "Your wording" : "Dial’s wording"} · confirmation email ${current.correspondence.inviteeConfirmationEnabled ? "on" : "off"}`, content: <EmailsAndCalendarInvite event={eventValues} correspondence={data.correspondence} operators={data.operators.operators} hostName={hostName} onSaved={updated} /> },
    { name: "Time zone", icon: "daylight", summary: policy.lockedTimezone ? `Times stay in ${policy.lockedTimezone}` : "Times show in each invitee’s own zone", content: <TimeZone {...changed} policy={data.policy} /> },
    { name: "After booking", icon: "link", summary: details.values.postBookingRedirect ? "Open your thank-you page" : "Show the booking confirmation", content: <AfterBooking details={details} /> },
    { name: "Address and listing", icon: "file", summary: `${details.values.slug} · ${details.values.listed ? "on your public profile" : "link only"}`, content: <AddressAndListing details={details} live={event.status === "published"} /> },
    ...(data.fields.length ? [{ name: "Private fields", icon: "shield" as const, summary: `${data.fields.length} private field${data.fields.length === 1 ? "" : "s"}`, content: <ExtensionSlot id="event-type.settings.after.v1" entityId={event.id} autosave onSaved={onSaved} /> }] : []),
  ];
  return <Card className="advanced-groups">{groups.map((group, index) => {
    const expanded = open === group.name;
    return <div key={group.name} className="advanced-group"><button className="advanced-group-row" type="button" aria-expanded={expanded} aria-controls={`advanced-group-${index}`} onClick={() => { setOpen(expanded ? undefined : group.name); setVisited(previous => new Set([...previous, group.name])); }}><IconTile icon={group.icon} /><span className="min-w-0"><span className="block font-bold">{group.name}</span><span className="mt-1 block text-sm font-normal text-soft">{group.summary}</span></span><span aria-hidden="true" className="advanced-group-chevron">{expanded ? "⌄" : "›"}</span></button><div id={`advanced-group-${index}`} className="advanced-group-fields" hidden={!expanded}>{visited.has(group.name) ? group.content : null}</div></div>;
  })}</Card>;
}
function cutoff(minutes: number | null) { return minutes === null ? "your usual rule" : minutes === 0 ? "until the start" : `${minutes / 60} hours before`; }
function priceSummary(price: EventPrice) { return price.amountCents === null && !price.durationPrices.length ? "Free" : price.amountCents !== null ? `$${price.amountCents / 100}` : "Prices by length"; }
