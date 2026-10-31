import { createId, nowIso } from "../../shared/ids";
import { foldEmail } from "../erasure";
import { clientExistsSql } from "./participation";

export type ClientProfile = { id: string; email: string; revision: number };
export class ClientRecords {
  constructor(private readonly db: D1Database) {}
  async profile(email: string) { return this.db.prepare("SELECT c.id,c.email,c.revision FROM client_profiles c JOIN client_aliases a ON a.client_id=c.id WHERE a.email=?").bind(foldEmail(email)).first<ClientProfile>(); }
  async addresses(email: string) {
    const profile = await this.profile(email);
    return profile ? (await this.db.prepare("SELECT email FROM client_aliases WHERE client_id=? ORDER BY email").bind(profile.id).all<{ email: string }>()).results.map(row => row.email) : [foldEmail(email)];
  }
  async details(email: string) {
    const profile = await this.profile(email);
    if (!profile) return { email: foldEmail(email), aliases: [foldEmail(email)], notes: [], fields: [] };
    const [aliases, notes, fields] = await Promise.all([
      this.addresses(email),
      this.db.prepare("SELECT n.id,n.body,n.operator_id AS operatorId,coalesce(o.display_name,'') AS author,n.created_at AS createdAt FROM client_notes n LEFT JOIN oa_operators o ON o.id=n.operator_id WHERE n.client_id=? ORDER BY n.created_at,n.id").bind(profile.id).all<{id:string;body:string;operatorId:string;author:string;createdAt:string}>(),
      this.db.prepare("SELECT id,label,value FROM client_fields WHERE client_id=? ORDER BY created_at,id").bind(profile.id).all<{id:string;label:string;value:string}>(),
    ]);
    return { email: profile.email, aliases, notes: notes.results, fields: fields.results };
  }
  private async known(email: string) { return Boolean((await this.db.prepare(`SELECT ${clientExistsSql} AS known`).bind(JSON.stringify(await this.addresses(email))).first<{known:number}>())?.known); }
  private existenceGuard(addresses: string[]) { return this.db.prepare(`SELECT CASE WHEN ${clientExistsSql} THEN 1 ELSE abs(-9223372036854775808) END`).bind(JSON.stringify(addresses)); }
  private profileStatements(email: string, id: string, now: string) {
    return [this.db.prepare("INSERT INTO client_profiles(id,email,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(email) DO NOTHING").bind(id,email,now,now),
      this.db.prepare("INSERT INTO client_aliases(email,client_id,created_at,updated_at) SELECT ?,id,?,? FROM client_profiles WHERE email=? ON CONFLICT(email) DO NOTHING").bind(email,now,now,email)];
  }
  private guard(addresses: string[]) { return this.db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email IN(SELECT value FROM json_each(?))) THEN 1 ELSE abs(-9223372036854775808) END").bind(JSON.stringify(addresses)); }
  async add(email: string, input: { body: string; operatorId: string } | { label: string; value: string }) {
    email = foldEmail(email);
    if (!await this.known(email)) return null;
    const profile = await this.profile(email), id = createId(), now = nowIso(), clientId = profile?.id ?? createId();
    const addresses = await this.addresses(email);
    const statements = [this.guard(addresses), this.existenceGuard(addresses), ...(!profile ? this.profileStatements(email,clientId,now) : [])];
    const client = "(SELECT client_id FROM client_aliases WHERE email=?)";
    if ("body" in input) statements.push(this.db.prepare(`INSERT INTO client_notes(id,client_id,body,operator_id,created_at,updated_at) VALUES(?,${client},?,?,?,?)`).bind(id,email,input.body,input.operatorId,now,now));
    else statements.push(this.db.prepare(`INSERT INTO client_fields(id,client_id,label,value,created_at,updated_at) SELECT ?,${client},?,?,?,? WHERE (SELECT count(*) FROM client_fields WHERE client_id=${client})<20`).bind(id,email,input.label,input.value,now,now,email));
    statements.push(this.db.prepare(`UPDATE client_profiles SET revision=revision+1,updated_at=? WHERE id=${client}`).bind(now,email));
    const result = await this.db.batch(statements);
    return result[statements.length - 2].meta.changes ? id : null;
  }
  /** Edits (body) or removes (no body) one note of the client the address belongs to; false when it is not theirs. */
  async changeNote(email: string, noteId: string, body?: string) {
    email = foldEmail(email);
    const profile = await this.profile(email);
    if (!profile) return false;
    const now = nowIso(), owned = "client_id=? AND id=?";
    const statements = [this.guard(await this.addresses(email)), this.db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM client_notes WHERE ${owned}) THEN 1 ELSE abs(-9223372036854775808) END`).bind(profile.id, noteId),
      body === undefined ? this.db.prepare(`DELETE FROM client_notes WHERE ${owned}`).bind(profile.id, noteId) : this.db.prepare(`UPDATE client_notes SET body=?,updated_at=? WHERE ${owned}`).bind(body, now, profile.id, noteId),
      this.db.prepare("UPDATE client_profiles SET revision=revision+1,updated_at=? WHERE id=?").bind(now, profile.id)];
    try { await this.db.batch(statements); return true; } catch { return false; }
  }
  async merge(source: string, target: string, operatorId: string) {
    source = foldEmail(source); target = foldEmail(target);
    const [from,to] = await Promise.all([this.profile(source),this.profile(target)]);
    if (source === target || from && to && from.id === to.id) return "identical" as const;
    if (!await this.known(source) || !await this.known(target)) return "missing" as const;
    const sourceId = from?.id ?? createId(), targetId = to?.id ?? createId(), now = nowIso();
    const sourceAddresses = await this.addresses(source), targetAddresses = await this.addresses(target);
    const addresses = [...sourceAddresses, ...targetAddresses];
    await this.db.batch([
      this.guard(addresses),
      this.existenceGuard(sourceAddresses), this.existenceGuard(targetAddresses),
      this.db.prepare("SELECT CASE WHEN coalesce((SELECT client_id FROM client_aliases WHERE email=?),'')=? AND coalesce((SELECT client_id FROM client_aliases WHERE email=?),'')=? THEN 1 ELSE abs(-9223372036854775808) END").bind(source,from?.id ?? "",target,to?.id ?? ""),
      ...(!from ? this.profileStatements(source,sourceId,now) : []), ...(!to ? this.profileStatements(target,targetId,now) : []),
      this.db.prepare("UPDATE client_notes SET client_id=?,updated_at=? WHERE client_id=?").bind(targetId,now,sourceId),
      this.db.prepare("UPDATE client_fields SET client_id=?,updated_at=? WHERE client_id=?").bind(targetId,now,sourceId),
      this.db.prepare("UPDATE client_aliases SET client_id=?,updated_at=? WHERE client_id=?").bind(targetId,now,sourceId),
      this.db.prepare("DELETE FROM client_profiles WHERE id=?").bind(sourceId),
      this.db.prepare("UPDATE client_profiles SET revision=revision+1,updated_at=? WHERE id=?").bind(now,targetId),
      this.db.prepare("INSERT INTO anonymized_audit(id,entity_kind,action,actor_type,actor_id,happened_at,erased_at) VALUES(?,'client','merged','operator',?,?,?)").bind(createId(),operatorId,now,now),
    ]);
    return "merged" as const;
  }
}
