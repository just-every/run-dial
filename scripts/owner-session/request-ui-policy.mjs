import {must} from './assert.mjs';
export const bookableTimeSelector='button[data-start-at]';
export const dayGroupName='Choose a day';
export const legacyBookingSelector='.pb-stepper, a[href*="/availability"]';
export async function assertRequestsOnlyControls(page) {
 must(await page.locator(bookableTimeSelector).count()===0,'disconnected-page-offered-slot');
 must(await page.locator(legacyBookingSelector).count()===0,'disconnected-page-offered-booking-navigation');
 must(await page.getByRole('link',{name:/availability/i}).count()===0,'disconnected-page-offered-availability-link');
 must(await page.getByRole('group',{name:dayGroupName,exact:true}).count()===0,'disconnected-page-offered-day-picker');
}
