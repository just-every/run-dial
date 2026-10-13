import type { AppBindings } from "../../src/core/app/bindings";
import { isolatedProviderDb } from "../review/providers";
import type { MailSender } from "../../src/core/platform/mail";
import { ProviderFailure } from "../../src/core/platform/calendar";

export async function pause(db: D1Database, stage: string) {
  const control = await db.prepare("SELECT stage FROM order_control WHERE singleton = 1").first<{ stage: string }>();
  if (control?.stage !== stage) return;
  await db.prepare("UPDATE order_control SET reached = 1 WHERE singleton = 1").run();
  while ((await db.prepare("SELECT released FROM order_control WHERE singleton = 1").first<{ released: number }>())?.released === 0) {
    await new Promise((done) => setTimeout(done, 10));
  }
}

// Evaluate the actual D1 SELECT, then delay its response. No SQL or application
// result is changed, so a concurrent removal really commits against stale data.
export function delayedBinding(db: D1Database, providerDb: D1Database, stage: string): D1Database {
  return new Proxy(db, { get(target, key) {
    if (key !== "prepare") { const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value; }
    return (sql: string) => wrap(target.prepare(sql), sql);
  } });
  function wrap(statement: D1PreparedStatement, sql: string): D1PreparedStatement {
    return new Proxy(statement, { get(target, key) {
      if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values), sql);
      if (key === "first") return async (...args: Parameters<D1PreparedStatement["first"]>) => {
        const value = await target.first(...args);
        if (sql.startsWith("SELECT 1 FROM delivery_outbox d")) await pause(providerDb, stage);
        return value;
      };
      if (key === "all" || key === "raw") return async () => {
        const value = await (key === "raw" ? target.raw() : target.all());
        if (/from\s+"?operators"?/i.test(sql) && sql.includes("access_generation")) await pause(providerDb, "recipients");
        return value;
      };
      if (key === "run") return async () => {
        const value = await target.run();
        if (sql.startsWith("INSERT INTO operator_mail_invocations")) await pause(providerDb, "admission");
        return value;
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
  }
}

export function mailSink(env: AppBindings): MailSender {
  const providerDb = isolatedProviderDb(env);
  return {
    async checkConnection() { return { checkedAt: new Date().toISOString() }; },
    async send(message) {
      const recipient = await env.DB.prepare("SELECT removed_at FROM operators WHERE normalized_email = ?").bind(message.to).first<{ removed_at: string | null }>();
      const source = await env.DB.prepare(`SELECT d.state, i.state AS invocation_state FROM delivery_outbox d
        LEFT JOIN operator_mail_invocations i ON i.outbox_id = d.id AND i.attempt_number = d.attempts
        WHERE COALESCE(json_extract(d.payload_json, '$.providerIdempotencyKey'), d.idempotency_key) = ?
        ORDER BY d.updated_at DESC LIMIT 1`).bind(message.idempotencyKey).first<{ state: string; invocation_state: string | null }>();
      const captured = await providerDb.prepare(`INSERT INTO order_calls
        (key, message_json, recipient_removed, recipient_present, source_present, source_state, invocation_state)
        VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
        .bind(message.idempotencyKey, JSON.stringify(message), recipient?.removed_at ?? null,
          recipient ? 1 : 0, source ? 1 : 0, source?.state ?? null, source?.invocation_state ?? null).first<{ id: number }>();
      if (!captured) throw new Error("External provider observation was not persisted");
      await pause(providerDb, "provider");
      const mode = await providerDb.prepare("SELECT failure FROM order_control WHERE singleton = 1").first<{ failure: number }>();
      if (mode?.failure) {
        await providerDb.prepare("UPDATE order_calls SET provider_outcome = 'provider_timeout' WHERE id = ?").bind(captured.id).run();
        throw new ProviderFailure("provider_timeout", true);
      }
      const providerMessageId = `synthetic:${message.idempotencyKey}`;
      await providerDb.prepare("UPDATE order_calls SET provider_outcome = 'succeeded', provider_message_id = ? WHERE id = ?").bind(providerMessageId, captured.id).run();
      return { providerMessageId };
    },
  };
}
