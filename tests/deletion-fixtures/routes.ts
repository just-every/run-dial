import type { AppBindings } from "../../src/core/app/bindings";
import type { AppServices } from "../../src/core/app/services";
import { processDueCalendarDeletionProbes } from "../../src/core/app/booking-coordination";
import { handleFixtures } from "../review/fixture-routes";
import { isolatedProviderDb } from "../review/providers";
import { status } from "../review/setup";
import { createInspectionFixtures, storeInspection } from "./providers";

export async function handleDeletionFixtures(request: Request, env: AppBindings, servicesFor: (env: AppBindings) => AppServices) {
  const providerDb = isolatedProviderDb(env);
  const url = new URL(request.url);
  if (url.pathname === "/__fixtures/setup" && request.method === "POST") {
    await createInspectionFixtures(providerDb);
    return handleFixtures(request, env, servicesFor);
  }
  if (url.pathname === "/__fixtures/reset" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM calendar_deletion_probes").run();
    await providerDb.batch(["deletion_fixture_inspections", "deletion_fixture_notes"].map((table) => providerDb.prepare(`DELETE FROM ${table}`)));
    return handleFixtures(request, env, servicesFor);
  }
  if (url.pathname === "/__fixtures/inspection" && request.method === "POST") {
    const input = await request.json<{ providerEventId: string; result: Parameters<typeof storeInspection>[2]; resurrect?: boolean }>();
    await storeInspection(providerDb, input.providerEventId, input.result);
    if (input.resurrect && input.result.kind === "present") await providerDb.prepare("UPDATE fixture_events SET state = 'active', updated_at = ? WHERE booking_id = ?").bind(input.result.event.updatedAt, input.result.event.bookingId).run();
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/__fixtures/deletion-status") return Response.json({
    ...await status(env.DB, providerDb),
    calendar_deletion_probes: (await env.DB.prepare("SELECT * FROM calendar_deletion_probes").all()).results,
    deletion_fixture_inspections: (await providerDb.prepare("SELECT * FROM deletion_fixture_inspections").all()).results,
  });
  if (url.pathname === "/__fixtures/retry-probes" && request.method === "POST") {
    await env.DB.prepare("UPDATE calendar_deletion_probes SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE state = 'pending'").run();
    return Response.json({ result: await processDueCalendarDeletionProbes(env) });
  }
  if (url.pathname === "/__fixtures/deletion-note" && request.method === "POST") {
    const input = await request.json<{ key: string; value: unknown }>();
    await providerDb.prepare("INSERT INTO deletion_fixture_notes (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").bind(input.key, JSON.stringify(input.value)).run();
    return new Response(null, { status: 204 });
  }
  if (url.pathname === "/__fixtures/deletion-note") {
    const note = await providerDb.prepare("SELECT value_json AS valueJson FROM deletion_fixture_notes WHERE key = ?").bind(url.searchParams.get("key")).first<{ valueJson: string }>();
    return note ? Response.json(JSON.parse(note.valueJson)) : new Response("Missing fixture note", { status: 404 });
  }
  return handleFixtures(request, env, servicesFor);
}
