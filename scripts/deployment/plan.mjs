import { validateSetup } from "../setup/configuration.mjs";
import { assert, validatePlan } from "../../modules/deploy-kit/validation.mjs";
export function dialPlan(artifact, setup) {
  validateSetup(setup);
  assert(artifact.migrations.every(x => x.binding === "DB"), "unexpected-migration-binding");
  const prefix = setup.prefix;
  return validatePlan({version:1,worker:prefix,compatibilityDate:"2026-09-08",compatibilityFlags:["nodejs_compat"],
    d1:[{binding:"DB",name:`${prefix}-db`,migrations:artifact.migrations.map(({name,sql,sha256})=>({name,sql,sha256}))}],
    r2:[{binding:"FILES",name:`${prefix}-files`}],
    queues:[{binding:"JOBS",name:`${prefix}-jobs`,deadLetterQueue:`${prefix}-jobs-dead`,consumer:{batch_size:10,max_wait_time_ms:1000,max_retries:3}},{binding:"JOBS_DEAD",name:`${prefix}-jobs-dead`}],
    durableObjects:[{binding:"BOOKING_COORDINATOR",className:"BookingCoordinator",storage:"sqlite"}],
    secrets:["SESSION_SECRET","SETUP_TOKEN","MAIL_API_KEY"].map(binding=>({binding,environment:binding})),
    crons:["* * * * *"],vars:{ENVIRONMENT:"production",APP_URL:setup.target,OWNER_EMAIL:setup.ownerEmail,MAIL_PROVIDER:setup.mailProvider,MAIL_FROM:setup.mailFrom}});
}
