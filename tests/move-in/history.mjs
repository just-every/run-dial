import assert from 'node:assert/strict';

/** Compare native booking detail with the selected source bytes and signed-in actor. */
export async function assertImportedHistory(rt,files,asOf,operatorId=rt.operator){
 const pages=files.filter(file=>file.name!=='manifest.json').map(file=>JSON.parse(file.bytes));
 const source=pages.flatMap(page=>page.collection??[]).filter(row=>row.start_time&&row.event_type);
 const invitees=pages.flatMap(page=>page.collection??[]).filter(row=>row.event&&row.email);
 const response=await rt.api('/api/app/bookings');assert.equal(response.status,200);
 const bookings=(await response.json()).filter(booking=>booking.imported);
 assert.ok(bookings.length);
 for(const listed of bookings){
  const response=await rt.api(`/api/app/bookings/${listed.id}`);assert.equal(response.status,200);
  const booking=await response.json();assert.deepEqual(booking.history,listed.history);
  const raw=source.find(row=>new Date(row.start_time).toISOString()===booking.occurrence.startAt&&invitees.some(invitee=>invitee.event===row.uri&&invitee.email===booking.inviteeEmail));assert.ok(raw);
  assert.equal(booking.createdAt,new Date(raw.created_at).toISOString(),'Source created time survives independently');
  const occurrence=await rt.db.prepare('SELECT created_at FROM booking_occurrences WHERE id=?').bind(booking.occurrence.id).first();assert.equal(occurrence.created_at,new Date(raw.created_at).toISOString());
  assert.equal(booking.locationValue,raw.location.join_url??raw.location.location??raw.location.phone_number,'Booking keeps its own source location');
  assert.equal(booking.history.length,1,'Each canonical import has one native creation history entry');
  const history=booking.history[0];assert.equal(history.action,'created');assert.equal(history.actorType,'operator');assert.equal(history.actorId,operatorId);
  assert.equal(history.occurrenceId,booking.occurrence.id);assert.equal(history.previousStartAt,null);assert.equal(history.newStartAt,booking.occurrence.startAt);
  assert.equal(history.createdAt,asOf);assert.notEqual(history.createdAt,booking.createdAt);
  assert.ok(history.reason,'The creation identifies the import action');
 }
 return bookings;
}

/** Reapplication preserves all native facts and gives each booking a fresh
 * unsent capability. Compare private hashes in memory without diagnostic leaks. */
export function assertFreshReimport(actual, previous){
 const before=previous.booking_manage_tokens,after=actual.booking_manage_tokens;
 assert.equal(after.length,before.length);
 for(const row of after){
  const old=before.find(prior=>prior.id===row.id);assert.ok(old);
  assert.ok(row.token_hash!==old.token_hash,'New application creates a fresh private capability');
 }
 const withoutHashes=rows=>rows.map(row=>{const copy={...row};delete copy.token_hash;return copy;});
 assert.deepEqual({...actual,booking_manage_tokens:withoutHashes(after)},
  {...previous,booking_manage_tokens:withoutHashes(before)});
}
