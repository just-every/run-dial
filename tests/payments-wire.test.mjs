import { startPaymentRuntime } from "./booking-wire/payment-runtime.mjs";
import { paymentFetch } from "./booking-wire/payment-request.mjs";
import { runAxe } from "./booking-axe/run-axe.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { evidencePath } from "../scripts/evidence-path.mjs";

/** One journey against the production services in the booking-wire Worker, with Stripe synthetic at the HTTP edge. */
async function wireJourney(t, journey, port, log) {
  const state = await mkdtemp(resolve(tmpdir(), "dial-payment-wire-"));
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, CI: "1", DIAL_REVIEW_ORIGIN: origin };
  let runtime, output = "";
  t.after(async () => {
    await runtime?.dispose();
    // C.1 keeps captured Worker evidence free of generated manage capability URLs.
    await writeFile(evidencePath(log), output.replace(/\/manage\/(?:invite\/|balance\/)?[^/?\s"'<>]+/gu, "/manage/[redacted]")); await rm(state, { recursive: true, force: true });
  });
  const run = args => new Promise((done, reject) => {
    const child = spawn(args[0], args.slice(1), { env, stdio: "pipe" }); let log = "";
    child.stdout.on("data", chunk => { log += chunk; }); child.stderr.on("data", chunk => { log += chunk; });
    child.on("error", reject); child.on("exit", code => code === 0 ? done(log) : reject(new Error(log)));
  });
  runtime = await startPaymentRuntime({ state, port, origin, capture: message => { output += message + "\n"; } });
  assert.equal((await paymentFetch(origin + "/wire/init", { method: "POST" })).status, 200);
  console.log((await run(["node", journey])).trim());
}

test("PAY-001 a paid booking confirms only after Stripe's signed event", async t => { await wireJourney(t, "tests/booking-wire/payment-journey.mjs", 15758, "payment-wire-worker.log"); await runAxe(t, "tests/booking-wire/payment-entitlements-screens.mjs"); });

test("PAY-003/PAY-006 deposits, refunds, fees and reconciled accounting exports move or record money once, only as shown", async t => { await wireJourney(t, "tests/booking-wire/payment-terms-journey.mjs", 15760, "payment-terms-wire-worker.log"); await runAxe(t, "scripts/verify-money-screens.mjs"); });

test("PAY-005 Stripe Tax shows and charges tax by address, and receipts and invoices carry matching amounts", t => wireJourney(t, "tests/booking-wire/payment-tax-journey.mjs", 15764, "payment-tax-wire-worker.log"));
