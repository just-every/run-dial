import { sqlTokens } from './sql-tokens.mjs';
import { literal } from './migration-ledger.mjs';

// A migration claimed `applying` whose import never completed is re-run only on
// proof that none of it applied. D1 imports the SQL and its completion marker as
// one atomic file, so one statement that fails when its effect already exists
// (CREATE without IF NOT EXISTS, ADD COLUMN, RENAME) and whose effect lasts to the
// end of the file proves it: its effect absent now means no attempt committed, and
// an earlier attempt that commits late makes the re-run fail whole instead of
// applying twice. Every such effect must be absent; any present one is refused.
// A name the file drops or renames away existed before it ran, so an object it
// makes again under that name (a rebuilt table, its indexes) proves nothing.

const word = token => token?.kind === 'word' ? token.value.toUpperCase() : '';
const lower = token => token?.kind === 'word' || token?.kind === 'identifier' ? token.value.toLowerCase() : undefined;
const symbol = (token, value) => token?.kind === 'symbol' && token.value === value;

// Trigger bodies split here too; their parts are DML and add or remove no guard.
function statements(sql) {
  const list = [[]];
  for (const token of sqlTokens(sql)) symbol(token, ';') ? list.push([]) : list.at(-1).push(token);
  return list.filter(statement => statement.length);
}

// [main.]name at index; anything in another schema is not checked.
function named(statement, index) {
  if (!symbol(statement[index + 1], '.')) return { name:lower(statement[index]), next:index + 1 };
  return { name:lower(statement[index]) === 'main' ? lower(statement[index + 2]) : undefined, next:index + 3 };
}

function create(statement) {
  let index = 1;
  if (['TEMP', 'TEMPORARY'].includes(word(statement[index]))) return undefined;
  if (['UNIQUE', 'VIRTUAL'].includes(word(statement[index]))) index++;
  const type = word(statement[index++]).toLowerCase();
  if (!['table', 'index', 'view', 'trigger'].includes(type) || word(statement[index]) === 'IF') return undefined;
  const target = named(statement, index);
  if (!target.name) return undefined;
  if (type === 'table' || type === 'view') return { type, object:target.name, table:target.name };
  const on = statement.findIndex((token, at) => at >= target.next && word(token) === 'ON');
  const table = on < 0 ? undefined : named(statement, on + 1).name;
  return table && { type, object:target.name, table };
}

/** The effects of a migration whose absence proves it never applied. */
export function retryGuards(sql) {
  let guards = [];
  const before = new Set();
  const guard = item => { if (!before.has(item.object) && !before.has(item.table) && !before.has(`${item.table}.${item.column}`)) guards.push(item); };
  for (const statement of statements(sql)) {
    const first = word(statement[0]);
    if (first === 'CREATE') {
      const created = create(statement);
      if (created) guard(created);
    } else if (first === 'ALTER' && word(statement[1]) === 'TABLE') {
      const { name:table, next } = named(statement, 2);
      let index = next;
      const action = word(statement[index++]);
      if (word(statement[index]) === 'COLUMN') index++;
      const column = lower(statement[index]);
      if (!table) guards = [];
      else if (action === 'ADD' && column) guard({ table, column });
      else if (action === 'RENAME' && word(statement[next + 1]) === 'TO') {
        const to = named(statement, next + 2).name;
        guards = guards.filter(item => item.table !== table);
        before.add(table);
        if (to) guard({ type:'table', object:to, table:to });
      } else if (action === 'RENAME' && column && word(statement[index + 1]) === 'TO' && lower(statement[index + 2])) {
        guards = guards.filter(item => !(item.table === table && item.column === column));
        before.add(`${table}.${column}`);
        guard({ table, column:lower(statement[index + 2]) });
      } else if (action === 'DROP' && column) {
        guards = guards.filter(item => !(item.table === table && item.column === column));
        before.add(`${table}.${column}`);
      } else guards = [];
    } else if (first === 'DROP') {
      const type = word(statement[1]);
      const { name } = named(statement, word(statement[2]) === 'IF' ? 4 : 2);
      // A later drop removes the effect it would prove; an unreadable one proves nothing.
      guards = name ? guards.filter(item => item.object !== name && !(['TABLE', 'VIEW'].includes(type) && item.table === name)) : [];
      if (name) before.add(name);
    }
  }
  return guards;
}

const label = guard => guard.column === undefined ? `${guard.type} ${guard.object}` : `column ${guard.table}.${guard.column}`;

/** Refuse unless the claimed migration's effects are provably absent: it then
 * may run again. `read(sql)` returns one SELECT's rows. D1 accepts at most five
 * terms in a compound SELECT, so objects and columns are each one plain query. */
export async function assertRetryable(read, migration) {
  const guards = retryGuards(migration.sql), present = [];
  const names = list => [...new Set(list)].map(literal).join(',');
  const objects = guards.filter(guard => guard.column === undefined), columns = guards.filter(guard => guard.column !== undefined);
  for (let start = 0; start < objects.length; start += 100) {
    const part = objects.slice(start, start + 100);
    const found = new Set((await read(`SELECT type, lower(name) AS name FROM sqlite_master WHERE lower(name) IN (${names(part.map(guard => guard.object))})`)).map(row => `${row.type} ${row.name}`));
    for (const guard of part) if (found.has(label(guard))) present.push(label(guard));
  }
  for (let start = 0; start < columns.length; start += 100) {
    const part = columns.slice(start, start + 100);
    const found = new Set((await read(`SELECT lower(m.name) AS tbl, lower(p.name) AS col FROM sqlite_master AS m, pragma_table_info(m.name) AS p WHERE m.type='table' AND lower(m.name) IN (${names(part.map(guard => guard.table))})`)).map(row => `column ${row.tbl}.${row.col}`));
    for (const guard of part) if (found.has(label(guard))) present.push(label(guard));
  }
  if (!guards.length || present.length) throw Object.assign(new Error('uncertain-migration-claim'), { migrationClaim:{ name:migration.name, present:[...new Set(present)] } });
}
