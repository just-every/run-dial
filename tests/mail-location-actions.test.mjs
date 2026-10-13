import assert from "node:assert/strict";
import { build } from "esbuild";
import { contract } from "./contract.mjs";
import { expectedLocationText, locationMail, unsafeLocations } from "./fixtures/mail-location.mjs";

let modules;
function sources() {
  return modules ??= Promise.all(["booking-mails", "reminders", "branded-layout"].map(async (name) => {
    const compiled = await build({ entryPoints: [new URL(`../src/core/features/delivery/${name}.ts`, import.meta.url).pathname], bundle: true, format: "esm", platform: "node", write: false });
    return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
  })).then(([booking, reminders, layout]) => ({ booking, reminders, layout }));
}

function compose(source, kind, role, overrides = {}) {
  const input = { ...locationMail, recipientRole: role, ...overrides };
  if (role === "operator") delete input.manageUrl;
  if (kind === "confirmation") return source.booking.bookingConfirmationMail(input);
  if (kind === "reschedule") return source.booking.bookingChangeHtml(input);
  if (kind === "cancellation") return source.booking.bookingCancellationMail(input);
  if (kind === "link-ready") return source.booking.bookingLinkReadyMail({ ...input, locationType: "google_meet", meetingUrl: input.locationValue });
  return source.reminders.reminderMessage({ ...input, title: input.eventTitle }, { to: input.inviteeEmail, recipientRole: role, ...(input.manageUrl ? { manageUrl: input.manageUrl } : {}) });
}

function actions(html) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gu)];
}

function assertLocationMessage(message, kind, role, location) {
  // ICU versions spell UTC's zero offset differently; all other expected bytes stay exact.
  const expected = ["GMT", "GMT+0"].map(offset => expectedLocationText(kind, role, location, offset));
  assert.ok(expected.includes(message.text), `${kind} ${role} text bytes must match a complete expected UTC range and body`);
  const htmlFacts = new Map([...message.html.matchAll(/<tr><td\b[^>]*>([^<]+)<\/td><td\b[^>]*>([^<]*)<\/td><\/tr>/gu)].map(([, label, value]) => [label, value]));
  for (const [, label, range] of message.text.matchAll(/^((?:(?:Previous|New) )?(?:Invitee|Host|invitee|host) time): (.+)$/gmu)) {
    assert.equal(htmlFacts.get(label), range, `${kind} ${role} HTML preserves the complete ${label} from text`);
  }
  if (kind === "reminder") assert.equal(htmlFacts.get("Time (UTC)"), message.text.split("\n")[1]);
}

const kinds = [
  ["NOTIFY-001", "confirmation"],
  ["NOTIFY-002", "link-ready"],
  ["NOTIFY-003", "reminder"],
  ["NOTIFY-004", "reschedule"],
  ["NOTIFY-004", "cancellation"],
];

for (const [clause, kind] of kinds) {
  contract(clause, `${kind} preserves unsafe joining values as exact text and escaped facts without an active HTML Join action`, async () => {
    const source = await sources();
    for (const locationValue of unsafeLocations) {
      for (const role of kind === "link-ready" ? ["invitee"] : ["invitee", "operator"]) {
        const message = compose(source, kind, role, { locationValue });
        assertLocationMessage(message, kind, role, locationValue);
        for (const value of [locationMail.hostName, locationMail.eventTitle, locationMail.locationLabel, locationValue]) assert.ok(message.html.includes(source.layout.escapeHtml(value)), `${kind} ${role} keeps escaped facts`);
        assert.doesNotMatch(message.html, /<(?:script|img|svg)\b/iu);
        const links = actions(message.html);
        assert.ok(links.every((link) => link[2] !== "Join session"), `${kind} ${role} has no unsafe Join action`);
        assert.deepEqual(links.map((link) => link[2]), role === "invitee" && kind !== "cancellation" ? ["Manage booking", "Add to calendar"] : []);
        if (role === "operator" || kind === "cancellation") assert.ok(!message.html.includes("location-mail-fixture"));
        if (kind === "reminder") assert.equal(message.subject, `Reminder: ${locationMail.eventTitle}`);
        if (kind === "cancellation") assert.equal(message.subject, `Booking cancelled: ${locationMail.eventTitle}`);
      }
    }
  });
}

contract("NOTIFY-001", "HTTP and HTTPS joining values remain active across every eligible mail composer", async () => {
  const source = await sources();
  for (const locationValue of ["https://session.example.test/room?next=%22quoted%22&guest=one", "http://session.example.test/room"]) {
    for (const [, kind] of kinds.filter(([, kind]) => kind !== "cancellation")) {
      for (const role of kind === "link-ready" ? ["invitee"] : ["invitee", "operator"]) {
        const message = compose(source, kind, role, { locationValue });
        const join = actions(message.html).filter((link) => link[2] === "Join session");
        assert.equal(join.length, 1);
        assert.equal(join[0][1], source.layout.escapeHtml(locationValue));
        assertLocationMessage(message, kind, role, locationValue);
      }
    }
  }
});

contract("NOTIFY-001", "plain physical and phone locations and pending meeting links acquire no mail Join action", async () => {
  const source = await sources();
  for (const [locationType, locationValue] of [["in_person", "Office <one>"], ["phone", "+61 400 000 000"], ["google_meet", ""]]) {
    for (const [, kind] of kinds.filter(([, kind]) => kind !== "link-ready")) {
      const message = compose(source, kind, "invitee", { locationType, locationValue, meetingUrl: null });
      assert.ok(actions(message.html).every((link) => link[2] !== "Join session"));
      if (locationType === "google_meet") assert.match(message.text, /(?:Google Meet|Meeting) link pending/);
      else assert.ok(message.text.includes(`${locationMail.locationLabel}: ${locationValue}`));
    }
  }
});

contract("AUTH-003", "unsafe trusted Manage and calendar actions still fail closed in every invitee mail composer", async () => {
  const source = await sources();
  const invalidManageUrls = [...unsafeLocations, "https://dial.example.test/not-a-manage-path"];
  for (const manageUrl of invalidManageUrls) {
    for (const [, kind] of kinds.filter(([, kind]) => kind !== "cancellation")) assert.throws(() => compose(source, kind, "invitee", { manageUrl }), TypeError);
    assert.throws(() => source.layout.inviteeCalendarUrl(manageUrl), TypeError);
  }
  for (const href of unsafeLocations) {
    for (const label of ["Manage booking", "Add to calendar"]) assert.throws(() => source.layout.renderBrandedMail({ heading: "Strict actions", actions: [{ label, href }] }), TypeError);
  }
});
