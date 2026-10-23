import { createApp } from "../../src/core/app/hono";
import { createServices } from "../../src/core/app/services";
import { ResendMailSender } from "../../src/core/platform/mail/resend";
import { parseRuntimeEnvironment } from "../../src/core/shared/runtime-env";
import type { AppBindings } from "../../src/core/app/bindings";
import { followUpFixtures } from "./fixture-routes";
import { SyntheticFollowUpMail } from "./mail";
export const mail = new SyntheticFollowUpMail();
export function servicesFor(env: AppBindings) { return createServices(env.DB, parseRuntimeEnvironment(env), env.ASSETS, { files: env.FILES, mail: new ResendMailSender({ apiKey: "synthetic-dial-1700", fromEmail: "synthetic-dial-1701@example.test" }, mail.request) }); }
const app = createApp(undefined, servicesFor);
export function fixtures(request: Request, env: AppBindings) { return followUpFixtures(request, env, servicesFor(env), [...mail.messages.values()]); }
export default { async fetch(request: Request, env: AppBindings, context: ExecutionContext) { return await fixtures(request, env) ?? app.fetch(request, env, context); }, async queue(batch: MessageBatch<unknown>) { for (const message of batch.messages) message.ack(); } } satisfies ExportedHandler<AppBindings>;
