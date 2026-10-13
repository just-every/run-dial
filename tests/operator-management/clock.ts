// Installed only by this test Worker, before the native adapter captures Date.now.
// A stable closure also updates any service that captured the clock earlier.
const wallNow = Date.now;
let projectedNow: number | undefined;
Date.now = () => projectedNow ?? wallNow();

export async function controlClock(request: Request) {
  if (request.method === "GET") return Response.json({ now: Date.now() });
  if (request.method !== "POST") return new Response(null, { status: 405 });
  let now: unknown;
  try { ({ now } = await request.json() as { now: unknown }); }
  catch { return new Response(null, { status: 400 }); }
  if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0 || now > 8.64e15
    || (projectedNow !== undefined && now < projectedNow)) return new Response(null, { status: 400 });
  projectedNow = now;
  return Response.json({ now: Date.now() });
}
