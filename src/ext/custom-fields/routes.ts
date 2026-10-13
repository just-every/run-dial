import { Hono } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../core/api/extensions";
import { apiError } from "../../core/shared/http";
import { validate } from "../../core/shared/validation";
import { definitionSchema, entitySchema } from "./model";
const target = z.object({ entity: entitySchema, id: z.string().min(1).max(80) });
export const customFieldRoutes = new Hono<AppEnvironment>()
  .use("/api/app/custom-fields/*", async (c,next) => { c.header("Cache-Control","no-store"); await next(); })
  .use("/api/app/custom-fields", async (c,next) => { c.header("Cache-Control","no-store"); await next(); })
  .get("/api/app/custom-fields", async c => c.json(await c.get("services").customFields.definitions()))
  .post("/api/app/custom-fields", validate("json", definitionSchema), async c => {
    const field = await c.get("services").customFields.create(c.req.valid("json"));
    return field ? c.json(field,201) : apiError(c,409,"field_limit","This entity has reached its custom field limit.");
  })
  .delete("/api/app/custom-fields/:fieldId", validate("param",z.object({fieldId:z.string().min(1).max(80)})), async c => await c.get("services").customFields.remove(c.req.param("fieldId")) ? c.json({ removed:true }) : apiError(c,404,"field_not_found","Custom field not found."))
  .get("/api/app/custom-fields/:entity/:id", validate("param",target), async c => {
    const {entity,id} = c.req.valid("param"), entries = await c.get("services").customFields.entries(entity,id);
    return entries ? c.json(entries) : apiError(c,404,"entity_not_found","Record not found.");
  })
  .put("/api/app/custom-fields/:entity/:id/:fieldId", validate("param",target.extend({fieldId:z.string().min(1).max(80)})), validate("json",z.object({value:z.union([z.string().max(5000),z.boolean(),z.null()])}).strict()), async c => {
    const {entity,id,fieldId} = c.req.valid("param");
    const result = await c.get("services").customFields.set(entity,id,fieldId,c.req.valid("json").value);
    return result === "saved" ? c.json({saved:true}) : result === "missing" ? apiError(c,404,"field_not_found","Record or custom field not found.") : apiError(c,400,"invalid_field_value","The value does not match this field's type or options.");
  });
