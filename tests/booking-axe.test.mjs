import {contract} from "./contract.mjs";
import {runAxe} from "./booking-axe/run-axe.mjs";

// These clause points share the same ordered browser sweep and its per-screen assertions.
contract(["PUBLIC-001", "AVAIL-005", "BOOK-005", "BOOK-007", "BOOK-008", "BOOK-011", "HOME-001", "DOCS-001", "AUTH-001"], "public booking, operator and public-site accessibility sweep at desktop and mobile", t => runAxe(t));
