import { contract } from './contract.mjs';
import { bookingRuntime } from './move-in/booking-runtime.mjs';
import { groupSeatJourney } from './booking-wire/group-seat-journey.mjs';

contract('EVENT-007', 'native group seats preserve capacity, individual authority and delivery through replay, cancellation and erasure', async context => {
  const rt = await bookingRuntime();
  try { await groupSeatJourney(rt, context); }
  finally { await rt.close(); }
});
