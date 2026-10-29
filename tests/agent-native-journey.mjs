export async function beforeStep({
  step,
  request,
  origin,
  args,
  outputs,
  cookie,
}) {
  if (step.id !== "live-schedule") return;
  const live = outputs.get
    ? outputs.get("live-update")
    : outputs["live-update"];
  if (!live?.record?.id) throw new Error("Live event fixture unavailable");
  const response = await request(
    new URL(`/api/app/event-types/${live.record.id}/hours`, origin),
    {
      method: "PUT",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify({ uses: args.id }),
    },
  );
  if (!response.ok) throw new Error("Native schedule binding refused");
}
export default async function () {}

// Advance a real native revision through the person's ordinary door, then prove
// that the old agent precondition refuses with an unchanged native record.
export async function afterStep({
  step,
  phase,
  result,
  request,
  origin,
  cookie,
  tool,
}) {
  if (step.id !== "read" || !["autonomous", "held"].includes(phase)) return;
  const old = result.record;
  const response = await request(
    new URL(`/api/app/event-types/${old.id}/disable`, origin),
    { method: "POST", headers: { cookie, origin } },
  );
  if (!response.ok) throw new Error("Native revision preparation refused");
  const before = await response.json();
  const refused = await tool("dial.event.hours", {
    id: old.id,
    windows: [],
    expected_revision: old.updatedAt,
    idempotency_key: crypto.randomUUID(),
  });
  if (
    refused.result?._meta?.["com.runeditrun/error"]?.code !==
    "revision_conflict"
  )
    throw new Error("Stale native revision was not refused");
  const read = await request(
    new URL(`/api/app/event-types/${old.id}`, origin),
    { headers: { cookie, origin } },
  );
  if (!read.ok || JSON.stringify(await read.json()) !== JSON.stringify(before))
    throw new Error("Stale agent call changed its native witness");
}
