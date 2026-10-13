/** Restore must enforce the same field semantics as private HTTP mutations. */
export function validateCustomFields(db) {
 const definitions = db.prepare('SELECT * FROM ext_custom_field_definitions').all();
 const counts = new Map();
 for (const field of definitions) {
  const options = JSON.parse(field.options_json);
  if (field.label !== field.label.trim() || field.label.length < 1 || field.label.length > 120) throw Error('archive-invalid-custom-fields');
  if (options.some(value => typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 120) || new Set(options).size !== options.length) throw Error('archive-invalid-custom-fields');
  counts.set(field.entity, (counts.get(field.entity) ?? 0) + 1);
  if (counts.get(field.entity) > 20) throw Error('archive-invalid-custom-fields');
 }
 for (const value of db.prepare("SELECT v.value_json,d.options_json FROM ext_custom_field_values v JOIN ext_custom_field_definitions d ON d.id=v.definition_id WHERE d.kind='single_choice'").all()) {
  if (!JSON.parse(value.options_json).includes(JSON.parse(value.value_json))) throw Error('archive-invalid-custom-fields');
 }
}
