-- Durable SendGrid invocation custody, including acceptance without a receipt.
CREATE TABLE base_mail_dispatch (
 delivery_id TEXT PRIMARY KEY,
 payload_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('invoking','accepted','uncertain','rejected','rate_limited')),
 provider_message_id TEXT,
 updated_at TEXT NOT NULL
);
