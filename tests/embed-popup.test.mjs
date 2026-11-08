import { contract } from "./contract.mjs";
import { popupJourney } from "./embed-popup/journey.mjs";

contract(["EMBED-001", "BOOK-013"], "floating popup books once through a separate parent and redirects only after its safe booked event", popupJourney);
