import test from "node:test";
import { runAxe } from "./booking-axe/run-axe.mjs";

test("webhook Settings creates and deletes subscriptions and shows signed delivery status at desktop and phone widths", t => runAxe(t, "scripts/verify-webhook-settings.mjs"));
