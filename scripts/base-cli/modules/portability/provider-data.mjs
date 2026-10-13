import { all, quote, insist } from './storage.mjs';
import { sidecar, copyRowid } from './copies.mjs';
const TRANSIENT=['oa_setup_links','rer_dependency_keys','rer_dependency_pending','rer_dependency_codes','oa_provider_sessions','oa_provider_session_pins','oa_oidc_transactions','oa_step_up_challenges','oa_identity_provider_health'];
// Mandatory secret/session filtering even when a product explicitly includes a table.
export async function dropProviderData(db,tables,copies) {
 const commands=[];
 for(const table of tables) {
  const copy=copies[table.name];if(!copy)continue;
  const condition=TRANSIENT.includes(table.name)?'1':table.name==='oa_sessions' && table.columns.some(c=>c.name==='kind')?"kind='oidc'":null;
  if(condition) {
   commands.push(db.prepare(`DELETE FROM ${quote(sidecar(copy))} WHERE rer_portability_copy_rowid IN (SELECT ${copyRowid(table)} FROM ${quote(copy)} WHERE ${condition})`));
   commands.push(db.prepare(`DELETE FROM ${quote(copy)} WHERE ${condition}`));
  }
  if(table.name==='rer_dependency_link')commands.push(db.prepare(`UPDATE ${quote(copy)} SET needs_relink=1`));
  if(table.name==='oa_identity_providers')commands.push(db.prepare(`UPDATE ${quote(copy)} SET status='unlinked',jwks=NULL,pending_issuer=NULL,pending_client_id=NULL,pending_preset=NULL,pending_at=NULL`));
  if(table.name==='oa_auth_settings')commands.push(db.prepare(`UPDATE ${quote(copy)} SET idp_sign_in=0,first_setup=0,generation=generation+1`));
 }
 if(commands.length)await db.batch(commands);
}
export async function refuseProviderData(db,copies,tables) {
 for(const name of TRANSIENT) if(copies[name])insist(!(await all(db,`SELECT 1 FROM ${quote(copies[name])} LIMIT 1`)).length,'provider_transient_data',409);
 if(copies.oa_sessions && tables.find(t=>t.name==='oa_sessions')?.columns.some(c=>c.name==='kind'))insist(!(await all(db,`SELECT 1 FROM ${quote(copies.oa_sessions)} WHERE kind='oidc' LIMIT 1`)).length,'provider_session_data',409);
 if(copies.rer_dependency_link)insist(!(await all(db,`SELECT 1 FROM ${quote(copies.rer_dependency_link)} WHERE needs_relink!=1 LIMIT 1`)).length,'provider_relink_required',409);
 if(copies.oa_auth_settings)insist(!(await all(db,`SELECT 1 FROM ${quote(copies.oa_auth_settings)} WHERE idp_sign_in!=0 OR first_setup!=0 LIMIT 1`)).length,'provider_sign_in_must_be_off',409);
}
