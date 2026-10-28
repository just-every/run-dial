import { createId, nowIso } from "../../shared/ids";

export class TeamsRepository {
 constructor(private readonly db:D1Database) {}
 async list() {
  const teams=(await this.db.prepare("SELECT id,name,host_id AS hostId,created_at AS createdAt,updated_at AS updatedAt FROM teams ORDER BY created_at,id").all<{id:string;name:string;hostId:string;createdAt:string;updatedAt:string}>()).results;
  const members=(await this.db.prepare("SELECT team_id AS teamId,event_type_id AS eventTypeId FROM team_event_types ORDER BY event_type_id").all<{teamId:string;eventTypeId:string}>()).results;
  return teams.map(team=>({...team,eventTypeIds:members.filter(member=>member.teamId===team.id).map(member=>member.eventTypeId)}));
 }
 async eventExists(id:string) {
  return Boolean(await this.db.prepare("SELECT id FROM event_types WHERE id=?").bind(id).first());
 }
 async create(input:{name:string;eventTypeIds:string[]},hostId:string) {
  const id=createId(),now=nowIso(),eventTypeIds=[...new Set(input.eventTypeIds)];
  await this.db.batch([
   this.db.prepare("INSERT INTO teams(id,name,host_id,created_at,updated_at) VALUES(?,?,?,?,?)").bind(id,input.name,hostId,now,now),
   ...eventTypeIds.map(eventId=>this.db.prepare("INSERT INTO team_event_types(team_id,event_type_id,created_at,updated_at) VALUES(?,?,?,?)").bind(id,eventId,now,now)),
  ]);
  return {id,name:input.name,hostId,eventTypeIds,createdAt:now,updatedAt:now};
 }
}
