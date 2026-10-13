import {contract} from '../contract.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bookableTimeSelector,legacyBookingSelector,dayGroupName,assertRequestsOnlyControls} from '../../scripts/owner-session/request-ui-policy.mjs';
contract('EVENT-006','requests-only zero-control proof targets the current day picker and refuses either exposed control',async()=>{
 const source=await readFile(new URL('../../src/core/features/public-booking/ui/day-time-picker.tsx',import.meta.url),'utf8');
 assert.equal(bookableTimeSelector,'button[data-start-at]');assert.equal(dayGroupName,'Choose a day');
 assert.match(source,/<button[^>]*data-start-at=\{slot\.startAt\}/);assert.match(source,/aria-label="Choose a day"/);
 const page=(times,days,legacy=0)=>({locator(selector){assert.ok([bookableTimeSelector,legacyBookingSelector].includes(selector));return {count:async()=>selector===bookableTimeSelector?times:legacy};},getByRole(role,options){if(role==='link'){assert.equal(String(options.name),'/availability/i');return {count:async()=>legacy};}assert.equal(role,'group');assert.deepEqual(options,{name:dayGroupName,exact:true});return {count:async()=>days};}});
 await assertRequestsOnlyControls(page(0,0));await assert.rejects(()=>assertRequestsOnlyControls(page(1,0)),/offered-slot/);await assert.rejects(()=>assertRequestsOnlyControls(page(0,1)),/offered-day-picker/);await assert.rejects(()=>assertRequestsOnlyControls(page(0,0,1)),/offered-booking-navigation/);
});
