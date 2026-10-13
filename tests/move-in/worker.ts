import { headerFixture } from '../erasure/header-fixture';
import { readD1ImportOriginals } from '../../modules/import-kit/src/d1/index.ts';
import { stored } from '../../modules/import-kit/src/d1/jobs.ts';
import { importContext } from '../../src/core/features/move-in/service';
import { createApp } from '../../src/core/app/hono';
import { createServices } from '../../src/core/app/services';
import { parseRuntimeEnvironment } from '../../src/core/shared/runtime-env';
let queueCalls=0;
export default {
 async fetch(request:Request,env:Parameters<ReturnType<typeof createApp>['fetch']>[1],ctx:ExecutionContext){
  const services=createServices(env.DB,parseRuntimeEnvironment(env),env.ASSETS);
  const url=new URL(request.url);
  if(url.pathname==='/__fixtures/import-header'&&request.method==='POST'){const session=await services.operators.authenticate(request);if(!session)return new Response(null,{status:401});const {email}=await request.json<{email:string}>();return Response.json(await headerFixture(env.DB,email));}
  if(url.pathname.startsWith('/__fixtures/import-custody/')){const session=await services.operators.authenticate(request);if(!session)return new Response(null,{status:401});const id=url.pathname.split('/').at(-1)!;const context=importContext(env.DB,session);const originals=await readD1ImportOriginals(id,context);return Response.json({originals,...await stored(id,context)});}
  if(url.pathname==='/__fixtures/queue-count')return Response.json({queueCalls});
  if(url.pathname==='/__fixtures/drain'&&request.method==='POST')return Response.json(await services.delivery.processDue());
  const app=createApp(undefined,()=>services);
  const observed={...env,JOBS:{...env.JOBS,send:async(...args:Parameters<typeof env.JOBS.send>)=>{queueCalls++;return env.JOBS.send(...args);}}};
  return app.fetch(request,observed,ctx);
 }
};
