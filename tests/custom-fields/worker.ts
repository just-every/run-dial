import { operatorNotificationCommand } from "../../src/core/platform/operator-notification-boundary";
import { createApp } from '../../src/core/app/hono';
import { createServices } from '../../src/core/app/services';
import { parseRuntimeEnvironment } from '../../src/core/shared/runtime-env';
import type { AppBindings } from '../../src/core/app/bindings';
import { captureAuthMail, captureMail } from '../mail-capture';
const servicesFor=(env:AppBindings)=>createServices(env.DB,parseRuntimeEnvironment(env),env.ASSETS,{ operatorNotifications: operatorNotificationCommand(env.BOOKING_COORDINATOR),files:env.FILES,authMail:captureAuthMail(env.DB),mail:captureMail(env.DB)});
const app=createApp(undefined,servicesFor);
export default {
 async fetch(request:Request,env:AppBindings,context:ExecutionContext) {
  // Test-only loopback control drains actual production mail into the native development outbox.
  if(new URL(request.url).pathname==='/__fields/deliver' && new URL(request.url).hostname==='127.0.0.1') {
   const services=servicesFor(env);
   const rows=(await env.DB.prepare("SELECT id FROM delivery_outbox WHERE state='pending' AND kind IN ('mail_send','reminder') AND (json_extract(payload_json,'$.recipientRole')='invitee' OR json_type(payload_json,'$.pollParticipantId')='text')").all<{id:string}>()).results;
   const results=[];for(const row of rows)results.push(await services.delivery.process({outboxId:row.id}));
   return Response.json({results,failures:(await env.DB.prepare("SELECT kind,last_error_code FROM delivery_outbox WHERE state='failed'").all()).results});
  }
  return app.fetch(request,env,context);
 },
};
