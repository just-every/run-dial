import type { Plugin } from "vite";
import { schemaModel } from "./schema.mjs";
/** Build-time migration replay; only the resulting public schema proof enters the Worker. */
export function archiveSchema(): Plugin {
 const id = "virtual:dial-archive-schema", resolved = "\0" + id;
 return { name: "dial-archive-schema", resolveId(value) { if (value === id) return resolved; },
  async load(value) {
   if (value !== resolved) return;
   const model = await schemaModel();
   try { return `export default ${JSON.stringify({ migrations: model.migrations, catalog: model.catalog })};`; }
   finally { model.db.close(); }
  },
 };
}
