export { deploymentConfig } from "./config";
export { customFieldRoutes } from "./custom-fields/routes";
import { CustomFieldsRepository } from "./custom-fields/repository";
export const createCustomFields = (database: D1Database) => new CustomFieldsRepository(database);
