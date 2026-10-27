import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';

/** Unbooked purchases are personal records too; the native person door clears their authority and history. */
export async function personalEntitlements(rt,{email,aliasEmail,eventId,bookingId,controlId}) {
  const prefix=`synthetic-dial-${randomBytes(8).toString('hex')}`,now=new Date().toISOString();
  const product=`${prefix}-product`;
  await rt.db.prepare("INSERT INTO payment_products(id,event_type_id,kind,name,sessions,amount_cents,validity_days,created_at,updated_at) VALUES(?,?,'package','Synthetic sessions',3,300,30,?,?)").bind(product,eventId,now,now).run();
  const markers=[];
  async function purchase(suffix,address) {
    const id=`${prefix}-${suffix}`,hash=randomBytes(32).toString('hex'),key=randomBytes(32).toString('hex');
    markers.push(hash,key);
    await rt.db.prepare("INSERT INTO payment_entitlements(id,product_id,event_type_id,kind,sessions,balance,amount_cents,purchaser_email_folded,code_hash,purchase_key,account_id,state,expires_at,created_at,updated_at) VALUES(?,?,?,'package',3,2,300,?,?,?,'synthetic-dial-account','active','2030-01-01T00:00:00.000Z',?,?)").bind(id,product,eventId,address,hash,key,now,now).run();
    return id;
  }
  const linked=await purchase('linked',email),orphan=await purchase('unbooked',aliasEmail),control=await purchase('control','control-person-78321@example.test');
  for(const [id,targetBooking] of [[linked,bookingId],[control,controlId]]) await rt.db.prepare("INSERT INTO payment_redemptions(id,entitlement_id,booking_id,units,created_at,updated_at) VALUES(?,?,?,1,?,?)").bind(`${id}-redemption`,id,targetBooking,now,now).run();
  for(const id of [linked,orphan,control])await rt.db.prepare("INSERT INTO payment_entitlement_events(id,entitlement_id,created_at) VALUES(?,?,?)").bind(`${id}-event`,id,now).run();
  const retained=await rt.db.prepare('SELECT * FROM payment_entitlements WHERE id=?').bind(control).first();
  const controlHistory=(await rt.db.prepare('SELECT * FROM payment_redemptions WHERE entitlement_id=?').bind(control).all()).results;
  return {markers:markers.slice(0,4),async assertAdmissionClosed(){
    await assert.rejects(()=>purchase('racing',email),/person_erasure_in_progress/);
  },async assertErased(){
    assert.equal(await rt.db.prepare('SELECT 1 FROM payment_entitlements WHERE id IN(?,?)').bind(linked,orphan).first(),null,'both booked and unbooked purchaser balances are erased');
    for(const table of ['payment_redemptions','payment_entitlement_events'])assert.equal(await rt.db.prepare(`SELECT 1 FROM ${table} WHERE entitlement_id IN(?,?)`).bind(linked,orphan).first(),null,`${table}: dependent history retains no purchaser association`);
    assert.deepEqual(await rt.db.prepare('SELECT * FROM payment_entitlements WHERE id=?').bind(control).first(),retained,'control purchaser and balance remain unchanged');
    assert.deepEqual((await rt.db.prepare('SELECT * FROM payment_redemptions WHERE entitlement_id=?').bind(control).all()).results,controlHistory,'control redemption remains unchanged');
    assert.ok(await rt.db.prepare('SELECT 1 FROM payment_products WHERE id=?').bind(product).first(),'shared host configuration survives person erasure');
  }};
}
