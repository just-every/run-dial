import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

export async function webhookReceiver() {
  const captures = [], failures = new Map();
  let paused = false, dnsStarted;
  const heldDns = [];
  const server = createServer(async (request, response) => {
    if (request.url.startsWith("/__dns?")) {
      const url = new URL(request.url, "http://127.0.0.1"), type = Number(url.searchParams.get("type"));
      const reply = () => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ Status: 0, Answer: type === 1 ? [{ type, data: url.searchParams.get("name") === "private.synthetic.test" ? "127.0.0.1" : "93.184.216.34" }] : [] })); };
      if (paused) { heldDns.push(reply); dnsStarted?.(); } else reply();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const remaining = failures.get(request.url) ?? 0;
    failures.set(request.url, Math.max(0, remaining - 1));
    const status = remaining > 0 ? 500 : 204;
    captures.push({ path: request.url, body, headers: request.headers, status });
    response.writeHead(status); response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(Number(process.env.DIAL_WEBHOOK_RECEIVER_PORT ?? 15756), "127.0.0.1", resolve); });
  return {
    captures, fail: (path, count) => failures.set(path, count),
    pauseDns() { paused = true; return new Promise(resolve => { dnsStarted = resolve; }); },
    resumeDns() { paused = false; dnsStarted = undefined; heldDns.splice(0).forEach(reply => reply()); },
    verify(capture, secret) {
      const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(capture.headers["dial-signature"]);
      assert.ok(match, "timestamped HMAC header");
      const expected = createHmac("sha256", secret).update(`${match[1]}.${capture.body}`).digest("hex");
      assert.equal(match[2], expected, "receiver independently verifies the unchanged raw bytes");
      assert.equal(capture.headers["dial-event-id"], JSON.parse(capture.body).id);
      assert.ok(!capture.body.includes("/manage/"), "no booking manage capability");
    },
    close: () => { paused = false; heldDns.splice(0).forEach(reply => reply()); return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
