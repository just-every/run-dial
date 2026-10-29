const event = {
  slug: "synthetic-live",
  title: "Office planning",
  description: "An appointment with Jordan Rivera.",
  durationMinutes: 30,
  color: "#123456",
  locationType: "in_person",
  locationLabel: "Office",
  locationValue: "42 Example Street",
  listed: false,
  alternativeRequestsEnabled: true,
  slotIncrementMinutes: 30,
  minimumNoticeMinutes: 60,
  bookingHorizonDays: 30,
  beforeBufferMinutes: 0,
  afterBufferMinutes: 0,
  hostDayBookingLimit: null,
  postBookingRedirect: null,
  questions: [],
  availability: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
};
export default async function ({ request, origin, phase, cookie }) {
  if (["initial", "removed"].includes(phase)) return {};
  const call = async (path, method = "GET", body) => {
    const response = await request(new URL(path, origin), {
      method,
      headers: {
        cookie,
        origin,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      console.error("Native fixture HTTP", method, response.status);
      throw new Error("Native fixture refused");
    }
    return response.json();
  };
  await call("/api/app/profile", "PATCH", {
    handle: "synthetic-host",
    name: "Jordan Rivera",
    title: "Scheduling host",
    biography: "Planning and appointment scheduling.",
    timezone: "America/New_York",
    focusAreas: [],
    socialProof: [],
  });
  const records = await call("/api/app/event-types");
  for (const record of records)
    if (record.status === "published")
      await call(`/api/app/event-types/${record.id}/disable`, "POST");
  const slug = `synthetic-live-${crypto.randomUUID().slice(0, 8)}`;
  const input = { ...event, slug };
  const record = await call("/api/app/event-types", "POST", input);
  // Opening request-only availability needs only the native verified mail sender.
  await call(`/api/app/event-types/${record.id}/open-requests`, "POST");
  const deleteLive = await call("/api/app/event-types", "POST", {
    ...event,
    slug: `synthetic-delete-${crypto.randomUUID().slice(0, 8)}`,
  });
  await call(`/api/app/event-types/${deleteLive.id}/open-requests`, "POST");
  return {
    values: {
      live: { id: record.id, input },
      deleteLive: { id: deleteLive.id },
      injectionSlug: `synthetic-injection-${crypto.randomUUID().slice(0,8)}`,
      draft: {
        ...event,
        slug: `synthetic-draft-${crypto.randomUUID().slice(0, 8)}`,
      },
    },
  };
}
