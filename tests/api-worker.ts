// Native HTTP contract fixture; rendering is exercised against the emitted Worker.
import { createApp } from "../src/core/app/hono";
import type { AppBindings } from "../src/core/app/bindings";
const app = createApp();
export default {
  fetch(request: Request, env: AppBindings, context: ExecutionContext) { return app.fetch(request, env, context); },
  async queue(batch: MessageBatch<unknown>) { for (const message of batch.messages) message.ack(); },
} satisfies ExportedHandler<AppBindings>;
