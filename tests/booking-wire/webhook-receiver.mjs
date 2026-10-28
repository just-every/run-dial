import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

export async function webhookReceiver() {
  const captures = [], failures = new Map();
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const remaining = failures.get(request.url) ?? 0;
    failures.set(request.url, Math.max(0, remaining - 1));
    const status = remaining > 0 ? 500 : 204;
    captures.push({ path: request.url, body, headers: request.headers, status });
    response.writeHead(status); response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(15756, "127.0.0.1", resolve); });
  return {
    captures, fail: (path, count) => failures.set(path, count),
    verify(capture, secret) {
      const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(capture.headers["dial-signature"]);
      assert.ok(match, "timestamped HMAC header");
      const expected = createHmac("sha256", secret).update(`${match[1]}.${capture.body}`).digest("hex");
      assert.equal(match[2], expected, "receiver independently verifies the unchanged raw bytes");
      assert.equal(capture.headers["dial-event-id"], JSON.parse(capture.body).id);
      assert.ok(!capture.body.includes("/manage/"), "no booking manage capability");
    },
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
