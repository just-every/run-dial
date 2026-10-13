import { createId } from "../../core/shared/ids";
import type { FieldEntity } from "../../core/api/extensions";
import { maximumFieldsPerEntity, validValue, type FieldDefinition, type FieldEntry, type FieldValue } from "./model";
const targets = { eventType: ["event_types", "event_type_id"], booking: ["bookings", "booking_id"], availabilityRequest: ["availability_requests", "request_id"] } as const;
type DefinitionRow = Omit<FieldDefinition, "options" | "createdAt" | "updatedAt"> & { options_json: string; created_at: string; updated_at: string };
const definition = (row: DefinitionRow): FieldDefinition => ({ id: row.id, entity: row.entity, label: row.label, kind: row.kind, options: JSON.parse(row.options_json), createdAt: row.created_at, updatedAt: row.updated_at });
export class CustomFieldsRepository {
  constructor(private readonly db: D1Database) {}
  async definitions(entity?: FieldEntity) {
    const result = await this.db.prepare(`SELECT * FROM ext_custom_field_definitions ${entity ? "WHERE entity=?" : ""} ORDER BY created_at,id`).bind(...(entity ? [entity] : [])).all<DefinitionRow>();
    return result.results.map(definition);
  }
  async create(input: Omit<FieldDefinition, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString(), id = createId();
    const result = await this.db.prepare("INSERT INTO ext_custom_field_definitions(id,entity,label,kind,options_json,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM ext_custom_field_definitions WHERE entity=?) < ?")
      .bind(id,input.entity,input.label,input.kind,JSON.stringify(input.options),now,now,input.entity,maximumFieldsPerEntity).run();
    return result.meta.changes ? { ...input, id, createdAt: now, updatedAt: now } : null;
  }
  async remove(id: string) { return (await this.db.prepare("DELETE FROM ext_custom_field_definitions WHERE id=?").bind(id).run()).meta.changes > 0; }
  async entries(entity: FieldEntity, entityId: string): Promise<FieldEntry[] | null> {
    const [table,column] = targets[entity];
    if (!await this.db.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(entityId).first()) return null;
    const fields = await this.definitions(entity);
    const rows = (await this.db.prepare(`SELECT definition_id,value_json FROM ext_custom_field_values WHERE ${column}=?`).bind(entityId).all<{ definition_id: string; value_json: string }>()).results;
    return fields.map(field => ({ ...field, value: JSON.parse(rows.find(row => row.definition_id === field.id)?.value_json ?? "null") }));
  }
  async set(entity: FieldEntity, entityId: string, fieldId: string, value: FieldValue) {
    const entries = await this.entries(entity, entityId);
    const field = entries?.find(entry => entry.id === fieldId);
    if (!field) return "missing" as const;
    if (!validValue(field,value)) return "invalid" as const;
    const [,column] = targets[entity];
    if (value === null) await this.db.prepare(`DELETE FROM ext_custom_field_values WHERE definition_id=? AND ${column}=?`).bind(fieldId,entityId).run();
    else {
      const now = new Date().toISOString();
      await this.db.prepare(`INSERT INTO ext_custom_field_values(id,definition_id,entity,kind,${column},value_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(definition_id,${column}) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
        .bind(createId(),fieldId,entity,field.kind,entityId,JSON.stringify(value),now,now).run();
    }
    return "saved" as const;
  }
}
