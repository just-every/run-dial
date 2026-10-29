import { seal } from "../../platform/crypto/sealed";
import type { AdsProvider, GoogleConnection, LinkedInConnection, PublicAnalytics, Destination } from "./types";
import { tagsSchema } from "./types";

export class AnalyticsSettings {
  constructor(private readonly db: D1Database, private readonly secret: string) {}
  async tags(): Promise<PublicAnalytics> {
    const row = await this.db.prepare("SELECT tags_json FROM analytics_settings WHERE id='default'").first<{tags_json:string}>();
    return row ? tagsSchema.parse(JSON.parse(row.tags_json)) : {};
  }
  async saveTags(tags: PublicAnalytics) {
    const clean = tagsSchema.parse(tags), now = new Date().toISOString();
    await this.db.prepare("INSERT INTO analytics_settings(id,tags_json,created_at,updated_at) VALUES('default',?,?,?) ON CONFLICT(id) DO UPDATE SET tags_json=excluded.tags_json,updated_at=excluded.updated_at").bind(JSON.stringify(clean),now,now).run();
    return clean;
  }
  async connections() {
    const rows = (await this.db.prepare("SELECT provider,status,destination_json,reason FROM analytics_connections").all<{provider:AdsProvider;status:string;destination_json:string;reason:string|null}>()).results;
    const status = (provider: AdsProvider) => {
      const row = rows.find(row => row.provider === provider), destination: Destination = row ? JSON.parse(row.destination_json) : {};
      return { connected: row?.status === 'connected', ...(provider === 'google_ads' ? { ...(destination.customerId ? {customerId:destination.customerId} : {}), ...(destination.conversionAction ? {conversionAction:destination.conversionAction} : {}) } : destination.conversionId ? {conversionId:destination.conversionId} : {}), ...(row?.reason ? {reason:row.reason} : {}) };
    };
    return {google_ads:status('google_ads'),linkedin:status('linkedin')};
  }
  async connect(provider: AdsProvider, input: GoogleConnection | LinkedInConnection) {
    const { accessToken } = input;
    const destination: Destination = 'customerId' in input ? {customerId:input.customerId,conversionAction:input.conversionAction,...(input.loginCustomerId?{loginCustomerId:input.loginCustomerId}:{})} : {conversionId:input.conversionId};
    const credentials = {accessToken,...('developerToken' in input ? {developerToken:input.developerToken} : {})};
    const encrypted = await seal(JSON.stringify(credentials), this.secret), now = new Date().toISOString();
    await this.db.batch([
      this.db.prepare("INSERT INTO analytics_connections(provider,generation,status,credential_ciphertext,destination_json,created_at,updated_at) VALUES(?,1,'connected',?,?,?,?) ON CONFLICT(provider) DO UPDATE SET generation=generation+1,status='connected',credential_ciphertext=excluded.credential_ciphertext,destination_json=excluded.destination_json,reason=NULL,updated_at=excluded.updated_at").bind(provider,encrypted,JSON.stringify(destination),now,now),
      this.db.prepare("UPDATE analytics_deliveries SET state='failed',reason='connection_replaced',updated_at=? WHERE provider=? AND state IN ('pending','processing')").bind(now,provider),
    ]);
    return this.connections();
  }
  async disconnect(provider: AdsProvider) {
    const now = new Date().toISOString();
    await this.db.batch([
      this.db.prepare("UPDATE analytics_connections SET generation=generation+1,status='disconnected',credential_ciphertext=NULL,reason=NULL,updated_at=? WHERE provider=?").bind(now,provider),
      this.db.prepare("UPDATE analytics_deliveries SET state='failed',reason='connection_disconnected',updated_at=? WHERE provider=? AND state IN ('pending','processing')").bind(now,provider),
    ]);
    return this.connections();
  }
}
