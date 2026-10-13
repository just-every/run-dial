import { createApp } from "../../src/core/app/hono";
import { createServices } from "../../src/core/app/services";
import { OperatorsService } from "../../src/core/features/operators/service";
import type { MailSender } from "../../modules/operator-auth/index.mjs";
import type { RuntimeEnvironment } from "../../src/core/shared/runtime-env";

export function nativeApplication(db: D1Database, runtime: RuntimeEnvironment, sender?: MailSender) {
  const assets = { fetch: async () => new Response("Not found", { status: 404 }) } as Fetcher;
  const services = createServices(db, runtime, assets);
  services.operators = new OperatorsService(db, runtime, sender);
  return { app: createApp(undefined, () => services), operators: services.operators };
}
