import { excluded } from "../../shared/archive-exclusions.mjs";
import { applicationTables } from "./census";
import { ErasureError, type PortabilityFence } from "../../../modules/erasure/index.mjs";
import { createPortability } from "@runeditrun/rer/modules/portability";

const internal = /^(sqlite_(sequence|stat1|stat4)|d1_migrations|rer_migrations|_rer_deploy_migrations|rer_portability_(state|jobs|parts|segments|journal|epochs|guard|owned|snap_[a-zA-Z0-9_]+|stage_[a-zA-Z0-9_]+))$/;
export async function assertErasureCensus(db: D1Database) {
  const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>();
  const expected = new Set<string>(applicationTables);
  for (const { name } of results) if (!expected.has(name) && !name.startsWith('_cf_') && !internal.test(name)) throw new ErasureError(`unclassified_table:${name}`, 409);
  for (const name of expected) if (!results.some(row => row.name === name)) throw new ErasureError(`missing_table:${name}`, 503);
}

/** Only the maintained portability service writes the trusted archive fence. */
export async function erasurePortability(db: D1Database): Promise<PortabilityFence & { redactionStatements(): Promise<D1PreparedStatement[]> }> {
  await assertErasureCensus(db);
  const service = await createPortability({ db, policy: { product: "just-every/dial", excludeTables: [...applicationTables] } });
  // Never copy private admission keys into the durable journal. Native restore
  // excludes these tables, while the same batch still invalidates every transfer.
  return {
    redactionStatements: () => service.redactionStatements(),
    erasureStatements: (table, key) => Object.hasOwn(excluded, table) ? Promise.resolve([]) : service.erasureStatements(table, key),
    invalidateTransfersStatements: () => service.invalidateTransfersStatements(),
  };
}
