/** Identity projection used by product records; Base owns authentication storage. */
export type OperatorRecord = { id: string; email: string };
export type SessionRecord = OperatorRecord & { sessionId: string; expiresAt: string };
