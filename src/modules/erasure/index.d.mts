export type Cell = null | string | number;
export type Key = Record<string, Cell>;
type Match = { from: string; on: Record<string, string>; where?: never; params?: never } | { from: string; where: string; params?: string[]; on?: never };
export type Edge = Match & { table: string; blob?: { bucket: string; keyColumn: string } };
export type Redaction = Match & { table: string; set: Record<string, Cell>; reason: string };
export interface AuditReference { table: string; column: string; of: string; where?: string; clear?: Record<string, Cell> }
export interface Retained { table: string; reason: string }
export type PolicyInput = { db: D1Database; subject: Key; label: string };
export type RootRedaction = { identityColumns?: string[]; set: Record<string, Cell> | ((input: { subject: Key; anonymousId: string }) => Record<string, Cell> | Promise<Record<string, Cell>>); reason: string };
export interface Declaration {
  entity: string;
  root: { table: string; redact?: RootRedaction };
  edges?: Edge[];
  redact?: Redaction[];
  audit?: AuditReference[];
  retain?: Retained[];
  /** Seed policy: a reason refuses the erasure (409 `held:<reason>`). */
  hold?: (input: { db: D1Database; subject: Key }) => string | null | undefined | Promise<string | null | undefined>;
  /** Durable policy SQL before the first dependent deletion; also used by nativeStatements. */
  beforeStatements?: (input: PolicyInput) => D1PreparedStatement[] | Promise<D1PreparedStatement[]>;
  /** Final policy effects after graph deletion, before verification and the receipt. */
  statements?: (input: { db: D1Database; subject: Key; label: string }) => D1PreparedStatement[] | Promise<D1PreparedStatement[]>;
}
export interface Defined extends Readonly<Required<Omit<Declaration, 'hold' | 'beforeStatements' | 'statements'>>> { hold?: Declaration['hold']; beforeStatements?: Declaration['beforeStatements']; statements?: Declaration['statements']; deleted: string[]; tracked: string[] }
export interface Preview {
  entity: string; planHash: string; blobs: number; hold: string | null;
  deleted: Record<string, number>; redacted: Record<string, number>; audited: Record<string, number>; retained: Retained[];
}
export interface Receipt {
  id: string; entity: string; phase: 'deleting' | 'blobs' | 'complete'; label: string;
  planned: Record<string, number>; deleted: Record<string, number>; retained: Retained[];
  blobs: { total: number; deleted: number };
  requestedAt: string; committedAt: string | null; completedAt: string | null; seconds: number | null;
}
export interface D1Sql { sql: string; params: unknown[] }
export interface PortabilityFence {
  erasureStatements(table: string, primaryKey: Key): Promise<D1PreparedStatement[]>;
  /** Required when any declaration uses root.redact. */
  redactionStatements?(): Promise<D1PreparedStatement[]>;
  invalidateTransfersStatements(): Promise<D1PreparedStatement[]>;
}
export interface Erasure {
  preview(entity: string, subject: Key): Promise<Preview>;
  start(entity: string, subject: Key, options?: { planHash?: string }): Promise<Receipt>;
  commit(id: string, options?: { rows?: number; until?: number }): Promise<Receipt>;
  deleteBlobs(id: string, options?: { until?: number; page?: number }): Promise<Receipt>;
  run(id: string, options?: { rows?: number; until?: number }): Promise<Receipt>;
  receipt(id: string): Promise<Receipt>;
  nativeStatements(entity: string, subject: Key): Promise<{ operationId: string; statements: D1Sql[] }>;
}
export function defineErasure(declaration: Declaration): Defined;
export function createErasure(options: { db: D1Database; buckets?: Record<string, R2Bucket>; portability: PortabilityFence; declarations: (Declaration | Defined)[] }): Erasure;
export function toD1Sql(statement: D1PreparedStatement): D1Sql;
export class ErasureError extends Error { code: string; status: number; constructor(code: string, status?: number) }
/** Attributable rate-limit or counter rows: see README "Attributable counters". */
/** `live`: SQL predicate over the root row, true while the subject may be counted.
 * Required when the declaration's root is redacted (it must be false after redaction). */
export interface RateRoot { table: string; column: string; live?: string }
export interface RateSpec { entity: string; root: RateRoot; subject: Cell; rateTable: string; rateKey: string }
export function rateEdges(options: { entity: string; root: RateRoot; counters: { table: string; keyColumn: string }[] }): Edge[];
export function rateCorrelation(db: D1Database, spec: RateSpec): D1PreparedStatement[];
export function rateWrite(db: D1Database, spec: RateSpec, statements: D1PreparedStatement[]): Promise<D1Result[]>;
