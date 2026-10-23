import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnvironment } from '../../app/context';
import { validate } from '../../shared/validation';
import { apiError } from '../../shared/http';
import { NoticeFailure } from './types';
export const noticeRoutes=new Hono<AppEnvironment>()
 .onError((e,c)=>e instanceof NoticeFailure?apiError(c,e.status as 400,e.code,e.code.replaceAll('_',' ')):Promise.reject(e))
 .get('/api/app/notices',async c=>c.json(await c.get('services').notices.destinations.status()))
 .get('/api/app/notices/slack/oauth/start',validate('query',z.object({mode:z.enum(['channel','dm']),target:z.string().max(200).default('')})),async c=>c.redirect(await c.get('services').notices.destinations.begin(c.get('session'),c.req.valid('query').mode,c.req.valid('query').target),302))
 .put('/api/app/notices/teams',validate('json',z.object({workflowUrl:z.string().max(8192)}).strict()),async c=>c.json(await c.get('services').notices.destinations.teams(c.req.valid('json').workflowUrl)))
 .delete('/api/app/notices/:provider',validate('param',z.object({provider:z.enum(['slack','teams'])})),async c=>c.json(await c.get('services').notices.destinations.disconnect(c.req.valid('param').provider)))
 .get('/api/notices/slack/oauth/callback',validate('query',z.object({state:z.string().max(4096).optional(),code:z.string().max(4096).optional()})),async c=>await c.get('services').notices.destinations.complete({...c.req.valid('query'),session:await c.get('services').operators.authenticate(c.req.raw)})?c.redirect('/app/settings?notices=connected',302):apiError(c,400,'invalid_notice_oauth_state','The Slack connection could not be verified.'));
