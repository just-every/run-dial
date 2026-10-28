import { randomBytes } from 'node:crypto';
import { routingInput,routingAnswers } from '../booking-wire/routing-journey.mjs';
const form=routingInput('event_types-1','routing-archive'),answers=routingAnswers(1301);
export const routingOverrides={
 routing_forms:{title:form.title,slug:form.slug,configuration_json:JSON.stringify(form),published:1,revision:1},
 routing_submissions:{capability_id:null,form_title:form.title,rule_id:'qualified',rule_label:form.rules[0].label,answers_json:JSON.stringify(form.questions.map(q=>({key:q.key,label:q.label,kind:q.kind,value:answers[q.key],private:q.private??false}))),attribution_json:JSON.stringify({utm_source:'ads'}),invitee_email:answers.email},
};
export function routingAuthority(db){
 const token=randomBytes(32).toString('base64url'),hash=randomBytes(32).toString('base64url'),instant='2026-10-07T00:00:00.000Z';
 db.prepare('INSERT INTO routing_submission_tokens(id,form_id,token_hash,expires_at,consumed_at,created_at) VALUES(?,?,?,?,?,?)').run('synthetic-dial-1302','routing_forms-1',hash,'2099-01-01T00:00:00.000Z',instant,instant);
 db.prepare('UPDATE routing_submissions SET capability_id=?').run('synthetic-dial-1302');
 db.prepare('INSERT INTO routing_handoffs(submission_id,token_hash,event_type_id,expires_at,created_at) VALUES(?,?,?,?,?)').run('routing_submissions-1',hash+'2','event_types-1','2099-01-01T00:00:00.000Z',instant);
 db.prepare("UPDATE delivery_outbox SET payload_json=json_set(payload_json,'$.routingUrl',?)").run(`https://dial.example.test/book/dial-host/routing?routeToken=${token}`);
 return {token,hash};
}
