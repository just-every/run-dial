import {contract} from "./contract.mjs";
import {runAxe} from "./booking-axe/run-axe.mjs";

contract(["OPER-004","CLIENT-001","POLL-001","REPORT-002"], "NOTIFY-009 invitation replacement and NOTIFY-001 saved confirmation switch and honest suppression; booking records and client histories, annotations and merges at desktop and mobile", t => runAxe(t, "scripts/verify-booking-record.mjs"));
