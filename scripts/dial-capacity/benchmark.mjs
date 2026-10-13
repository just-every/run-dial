import { performance } from "node:perf_hooks";

const warmupRuns = 2;

export async function runBenchmark({ origin: requestedOrigin, runs, sessionCookie }) {
  if (!Number.isInteger(runs) || runs < 20) throw new Error("The benchmark needs at least 20 measured runs per filter.");
  const origin = localOrigin(requestedOrigin);
  const cookie = sessionCookie ?? process.env.DIAL_SESSION_COOKIE;
  if (!cookie) throw new Error("Set DIAL_SESSION_COOKIE to the native session cookie for the local operator account. The value is never printed.");

  const eventsResponse = await fetch(new URL("/api/app/event-types", origin), { headers: { cookie }, redirect: "manual" });
  if (!eventsResponse.ok) throw new Error(`The local event-type route answered ${eventsResponse.status}; check the local operator session.`);
  const events = await eventsResponse.json();
  if (!Array.isArray(events) || !events[0]?.id) throw new Error("The local install needs at least one event type before benchmarking.");

  const filters = [
    { name: "lifecycle state confirmed", query: { state: "confirmed" } },
    { name: "lifecycle state rescheduled", query: { state: "rescheduled" } },
    { name: "lifecycle state cancelled", query: { state: "cancelled" } },
    { name: "future start time", query: { time: "future" } },
    { name: "past start time", query: { time: "past" } },
    { name: "event type", query: { eventTypeId: events[0].id } },
    { name: "date range", query: { from: "2035-05-01T00:00:00.000Z", to: "2035-05-31T23:59:59.999Z" } },
    { name: "failed delivery", query: { deliveryFailed: "true" } },
    { name: "no failed deliveries", query: { deliveryFailed: "false" } },
    { name: "search broad case-insensitive substring", query: { query: "cApAcItY gUeSt" } },
    { name: "search broad case-insensitive substring, API default limit", query: { query: "cApAcItY gUeSt" }, limit: null },
    { name: "search selective email substring", query: { query: "GUEST-099999@" } },
    { name: "search no-match substring", query: { query: "absent-capacity-invitee" } },
    { name: "search Unicode case-insensitive name substring", query: { query: "élodie" }, expectedMatches: 1 },
    { name: "search short Unicode case-insensitive substring", query: { query: "él" }, expectedMatches: 1 },
    { name: "search Unicode full folding, expansion", query: { query: "STRASSE" }, expectedMatches: 1 },
    { name: "search Unicode full folding, sigma class", query: { query: "ςςς" }, expectedMatches: 1 },
    { name: "search long Unicode query", query: { query: "ß".repeat(145) }, expectedMatches: 1 },
    { name: "search long Unicode query, API default limit", query: { query: "ß".repeat(145) }, expectedMatches: 1, limit: null },
    { name: "combined filters and search", expectedMatches: 1_667, query: {
      state: "confirmed", time: "future", eventTypeId: events[0].id,
      from: "2035-01-01T00:00:00.000Z", to: "2035-01-31T23:59:59.999Z",
      deliveryFailed: "true", query: "cApAcItY gUeSt",
    } },
  ];
  const measurements = [];
  for (const filter of filters) {
    const limit = Object.hasOwn(filter, "limit") ? filter.limit : 100;
    for (let index = 0; index < warmupRuns; index += 1) await measure(origin, cookie, filter.query, limit);
    const samples = [];
    let representative;
    for (let index = 0; index < runs; index += 1) {
      representative = await measure(origin, cookie, filter.query, limit);
      samples.push(representative.durationMs);
    }
    if (filter.expectedMatches !== undefined && representative.matchingBookings !== filter.expectedMatches) {
      throw new Error(`The ${filter.name} route count was ${representative.matchingBookings}; the independent local fixture count is ${filter.expectedMatches}.`);
    }
    const sortedSamples = [...samples].sort((left, right) => left - right);
    measurements.push({
      filter: filter.name,
      runs,
      requestedLimit: limit ?? 500,
      query: filter.query,
      p50Ms: rounded(percentile(sortedSamples, 0.5)),
      p95Ms: rounded(percentile(sortedSamples, 0.95)),
      ...(filter.expectedMatches === undefined ? {} : { expectedMatches: filter.expectedMatches }),
      matchingBookings: representative.matchingBookings,
      returnedBookings: representative.returnedBookings,
      responseJsonBytes: representative.responseJsonBytes,
      samplesMs: samples,
    });
  }

  return {
    environment: "local Wrangler D1 and loopback Worker HTTP route",
    timingScope: "Request start through complete JSON body read and parse; response byte count is the JSON body only.",
    pageSize: 100,
    apiDefaultLimit: 500,
    measuredRunsPerFilter: runs,
    warmupRunsDiscardedPerFilter: warmupRuns,
    measurements,
  };
}

async function measure(origin, cookie, query, limit) {
  const params = new URLSearchParams(query);
  if (limit !== null) {
    params.set("limit", String(limit));
    params.set("offset", "0");
  }
  const startedAt = performance.now();
  const response = await fetch(new URL(`/api/app/bookings?${params}`, origin), { headers: { cookie }, redirect: "manual" });
  if (!response.ok) throw new Error(`The local booking-list route answered ${response.status}; no response body or cookie was printed.`);
  const totalHeader = response.headers.get("X-Total-Count");
  if (totalHeader === null) throw new Error("The booking-list route did not return X-Total-Count.");
  const total = Number(totalHeader);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("The booking-list route did not return a valid X-Total-Count header.");
  const body = await response.text();
  const bookings = JSON.parse(body);
  if (!Array.isArray(bookings)) throw new Error("The booking-list route did not return a JSON array.");
  const durationMs = performance.now() - startedAt;
  return { durationMs, matchingBookings: total, returnedBookings: bookings.length, responseJsonBytes: Buffer.byteLength(body) };
}

function localOrigin(requestedOrigin) {
  if (!requestedOrigin) throw new Error("Pass --origin with the local loopback app URL, for example http://127.0.0.1:8787.");
  const origin = new URL(requestedOrigin);
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) {
    throw new Error("Capacity measurements are restricted to an HTTP loopback URL.");
  }
  return origin;
}

function percentile(sorted, value) {
  const position = (sorted.length - 1) * value;
  const lower = Math.floor(position), fraction = position - lower;
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}
