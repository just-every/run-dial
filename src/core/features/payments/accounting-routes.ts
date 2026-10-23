import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { validate } from "../../shared/validation";
import { apiError } from "../../shared/http";
import { AccountingFailure } from "./accounting";
export const accountingRoutes = new Hono<AppEnvironment>()
  .onError((error,context)=>error instanceof AccountingFailure?apiError(context,error.status as 400,error.code,error.code.replaceAll('_',' ')):Promise.reject(error))
  .post('/api/app/bookings/:id/reconciliation/acknowledge',validate('param',z.object({id:z.string().length(26)})),validate('json',z.object({processorRef:z.string().min(1).max(200)}).strict()),async c=>c.json({resolved:await c.get('services').payments.reconciliation.resolve(c.req.valid('param').id,c.req.valid('json').processorRef,c.get('session').id)}))
  .get('/api/app/payments/reconciliation',async c=>c.json({rows:await c.get('services').payments.reconciliation.rows()}))
  .get('/api/app/payments/export.csv',async c=>new Response(await c.get('services').payments.reconciliation.csv(),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="dial-payments.csv"','cache-control':'no-store'}}))
  .get('/api/app/payments/accounting',async c=>c.json(await c.get('services').payments.accounting.status()))
  .get('/api/app/payments/accounting/accounts',async c=>c.json({accounts:await c.get('services').payments.accounting.accounts()}))
  .get('/api/app/payments/accounting/oauth/start',async c=>c.redirect(await c.get('services').payments.accounting.begin(c.get('session')),302))
  .put('/api/app/payments/accounting/mapping',validate('json',z.object({accountId:z.string().regex(/^[A-Za-z0-9-]{1,50}$/)}).strict()),async c=>c.json(await c.get('services').payments.accounting.map(c.req.valid('json').accountId)))
  .post('/api/app/payments/accounting/export',async c=>c.json({exports:await c.get('services').payments.accounting.export()}))
  .delete('/api/app/payments/accounting',async c=>c.json(await c.get('services').payments.accounting.disconnect()))
  .get('/api/payments/accounting/oauth/callback',validate('query',z.object({state:z.string().max(4096).optional(),code:z.string().max(4096).optional(),realmId:z.string().max(100).optional()})),async c=>{
    const connected=await c.get('services').payments.accounting.complete({...c.req.valid('query'),session:await c.get('services').operators.authenticate(c.req.raw)});
    return connected?c.redirect('/app/settings?accounting=connected',302):apiError(c,400,'invalid_accounting_oauth_state','The accounting connection could not be verified.');
  });
