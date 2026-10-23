import {contract} from './contract.mjs';
import {runAxe} from './booking-axe/run-axe.mjs';
// PUBLIC-001/AVAIL-005 cached aliases were merged without removing any journey assertions.
contract('PAY-007','single and combined approval screens share one existing browser at 1440 and 390',t=>runAxe(t,'scripts/verify-approval-screens.mjs'));
