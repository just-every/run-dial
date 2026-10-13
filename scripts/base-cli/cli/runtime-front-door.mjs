import { createServer } from 'node:net';
import { trafficProxy } from './server-proxy.mjs';

// All public serving, including setup's bounded runtime, uses this listener.
// The adapter receives a separate loopback port and keeps the public origin
// for application URLs, cookies and sign-in links.
export async function runtimeFrontDoor({ host, port, activity }) {
 const reservations = []; let runtimePort;
 try {
  do {
   const reservation = createServer(); reservations.push(reservation);
   await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
   runtimePort = reservation.address().port;
  } while (runtimePort === port);
 } finally { for (const reservation of reservations) if (reservation.listening) await new Promise(resolve => reservation.close(resolve)); }
 const observer = activity ?? { begin: () => () => {}, touch: () => {} };
 const proxy = await trafficProxy({ host, port, target: runtimePort, activity: observer });
 return { ...proxy, runtimePort };
}
