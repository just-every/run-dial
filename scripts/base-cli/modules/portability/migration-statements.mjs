import { tokens, identifier, folded } from './generated.mjs';

// Whether one migration statement can change rows a restore carries. Only
// CREATE TABLE (not AS SELECT), CREATE INDEX and ALTER TABLE ... ADD COLUMN
// are additive: SQLite refuses ADD COLUMN with a non-constant default, so a
// restored row takes the same value the migration gave existing rows. Any
// other statement (INSERT, UPDATE, DELETE, triggers, table rebuilds) changes
// data unless it names none of the restorable tables, as when it only touches
// operator-auth or other excluded tables.
export function changesData(sql,restorable) {
  const list=tokens(sql),words=list.map(t=>t.quoted?undefined:folded(t.text));
  const kind=words.slice(0,4).filter(w=>!['temp','temporary','unique'].includes(w)).slice(0,2).join(' ');
  if(kind==='create table')return topLevelWords(list,words).includes('as');
  if(kind==='create index')return false;
  if(kind==='alter table' && words.find((w,i)=>i>2 && ['add','rename','drop'].includes(w))==='add')return false;
  const names=new Set(restorable.map(folded));
  return list.some(t=>t.quoted ? !t.text.startsWith("'") && names.has(folded(identifier(t))) : t.text.split('.').some(part=>names.has(folded(part))));
}
function topLevelWords(list,words) {
  let depth=0;const result=[];
  list.forEach((t,i)=>{if(t.text==='(')depth++;else if(t.text===')')depth--;else if(!depth)result.push(words[i]);});
  return result;
}
