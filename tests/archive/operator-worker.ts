import { createApp } from '../../src/core/app/hono';
import type { AppBindings } from '../../src/core/app/bindings';
const app = createApp();
export default {
  fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    return app.fetch(request, env, context);
  },
};
