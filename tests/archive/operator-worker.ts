import { operatorNotificationCommand } from "../../src/core/platform/operator-notification-boundary";
import { createApp } from '../../src/core/app/hono';
import type { AppBindings } from '../../src/core/app/bindings';
import { createServices } from '../../src/core/app/services';
import { parseRuntimeEnvironment } from '../../src/core/shared/runtime-env';
import { captureAuthMail } from '../mail-capture';
const app = createApp(undefined, env => createServices(env.DB, parseRuntimeEnvironment(env), env.ASSETS, { operatorNotifications: operatorNotificationCommand(env.BOOKING_COORDINATOR), files: env.FILES, authMail: captureAuthMail(env.DB) }));
export default {
  fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    return app.fetch(request, env, context);
  },
};
