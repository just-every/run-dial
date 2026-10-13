import {must} from './assert.mjs';

function scopedOrigin(origin,prefix) {
 let url;try{url=new URL(origin);}catch{return false;}
 return url.protocol==='https:'&&url.origin===origin&&/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname)&&url.hostname.split('.')[0]===prefix;
}
export function assertTargetState(state,receipt,scope) {
 must(state?.account===scope.account&&state.prefix===scope.prefix&&scopedOrigin(state.origin,scope.prefix),'target-custody');
 must(receipt?.accountId===scope.account&&receipt.worker===scope.prefix&&receipt.origin===state.origin&&receipt.config?.vars?.APP_URL===state.origin&&receipt.config.vars.OWNER_EMAIL===state.ownerEmail,'target-receipt-custody');return state;
}
export function assertDisposableInputs({setup,plan},state,scope) {
 must(state?.account===scope.account&&state.prefix===scope.prefix&&setup?.prefix===scope.prefix&&plan?.worker===scope.prefix,'disposable-input-scope');
 must(scopedOrigin(setup.target,scope.prefix)&&setup.target===state.origin&&plan.vars?.APP_URL===state.origin,'disposable-origin-scope');
 must(setup.ownerEmail===scope.ownerEmail&&setup.ownerEmail===state.ownerEmail&&plan.vars.OWNER_EMAIL===state.ownerEmail,'disposable-owner-scope');
 must(setup.mailFrom===scope.mailFrom&&setup.mailFrom===state.mailFrom&&plan.vars.MAIL_FROM===state.mailFrom&&setup.mailProvider===scope.mailProvider&&plan.vars.MAIL_PROVIDER===scope.mailProvider,'disposable-mail-scope');
 must(['d1','r2','queues'].every(kind=>Array.isArray(plan[kind])&&plan[kind].every(resource=>resource.name.startsWith(scope.prefix+'-'))),'disposable-resource-scope');
 return true;
}
