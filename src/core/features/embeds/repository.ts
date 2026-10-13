import { asc } from "drizzle-orm";
import { createDatabase } from "../../platform/db/client";
import { embedAllowedOrigins } from "../../platform/db/request-embed-schema";
import { nowIso } from "../../shared/ids";

export class EmbedsRepository {
  private readonly db;

  constructor(binding: D1Database) {
    this.db = createDatabase(binding);
  }

  async listAllowedOrigins() {
    const records = await this.db.select({ origin: embedAllowedOrigins.origin }).from(embedAllowedOrigins).orderBy(asc(embedAllowedOrigins.origin));
    return records.map((record) => record.origin);
  }

  async replaceAllowedOrigins(origins: string[]) {
    const timestamp = nowIso();
    await this.db.batch([
      this.db.delete(embedAllowedOrigins),
      ...origins.map((origin) => this.db.insert(embedAllowedOrigins).values({ origin, createdAt: timestamp, updatedAt: timestamp })),
    ]);
    return this.listAllowedOrigins();
  }
}
