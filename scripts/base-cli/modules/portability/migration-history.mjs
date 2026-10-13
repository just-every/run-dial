import { DatabaseSync } from 'node:sqlite';
import { policy, schemaIdentity } from './catalogue.mjs';

// Replays a chosen set of the destination's migrations, in its applied order,
// into a scratch database and returns the resulting archive schema identity.
// Node runners only: restore uses it to place an older archive within the
// destination's history (see bridge.mjs). plan: [{name,statements}].
export function migrationReplay(plan,input) {
  const config=policy(input);
  return {names:plan.map(migration=>migration.name),statements:name=>plan.find(m=>m.name===name).statements,async schemaAfter(names) {
    const scratch=new DatabaseSync(':memory:');
    const db={prepare:sql=>{const query=scratch.prepare(sql);let values=[];return {bind(...args){values=args;return this;},async all(){return {results:query.all(...values)};}};}};
    try {
      for(const migration of plan.filter(m=>names.includes(m.name)))for(const sql of migration.statements)scratch.exec(sql);
      return await schemaIdentity(db,config);
    }finally{scratch.close();}
  },
  // The rows the whole replay leaves in each requested table, as sorted images (legacy-safety.mjs).
  // A table the replay lacks, or one holding more than `limit` rows, has no entry.
  async rowImages(requests,limit) {
    const scratch=new DatabaseSync(':memory:'),found=new Map();
    try {
      for(const migration of plan)for(const sql of migration.statements)scratch.exec(sql);
      for(const {name,columns} of requests) {
        try {
          const rows=scratch.prepare(`SELECT json_array(${columns.map(c=>`quote("${c.replaceAll('"','""')}")`).join(',')}) AS image FROM "${name.replaceAll('"','""')}" LIMIT ?`).all(limit+1).map(r=>r.image);
          if(rows.length<=limit)found.set(name,rows.sort());
        }catch{}
      }
      return found;
    }finally{scratch.close();}
  }};
}
