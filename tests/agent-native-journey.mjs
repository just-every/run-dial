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
