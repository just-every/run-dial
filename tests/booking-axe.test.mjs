import {contract} from "./contract.mjs";
import {runAxe} from "./booking-axe/run-axe.mjs";

let result;
const gate = t => result ??= runAxe(t);
contract(["PUBLIC-001","AVAIL-005"], "BOOK-005 pending-to-ready receipt and headless axe cover all seven public pages, original operator/request journeys, timezone search/history and new validation states at desktop and mobile", gate);
contract("BOOK-007", "native Brisbane reschedule picker, one confirm and held old slot work from a New York browser", gate);
contract("BOOK-008", "cancellation asks confirmation and cancelled bookings expose no change controls", gate);
contract("BOOK-011", "an ended booking marked attended with a note records its operator and time in the booking record, keeps its state and sends nothing", gate);
contract("HOME-001", "the installed Lobby passes axe at desktop and mobile and leaves browser storage empty after reload", gate);
contract("DOCS-001", "every published docs page passes axe at desktop and mobile, and docs navigation leaves browser storage empty", gate);

contract("AUTH-001", "both unclaimed setup widths precede the native claim; fresh sessionless reloads hide setup and refuse replay", gate);

contract(["OPER-004","CLIENT-001"], "NOTIFY-009 invitation replacement and NOTIFY-001 saved confirmation switch and honest suppression; booking records and client histories, annotations and merges at desktop and mobile", t => runAxe(t, "scripts/verify-booking-record.mjs"));
