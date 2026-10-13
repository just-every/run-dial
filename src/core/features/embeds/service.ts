import type { PublicProfileRecord } from "../host-profile";
import { EmbedsRepository } from "./repository";

export type EmbedPublicEventReader = { getPublicEvent(slug: string): Promise<{ slug: string } | undefined> };
export type EmbedPublicProfileReader = { getPublicProfile(handle: string): Promise<PublicProfileRecord | undefined> };

export class EmbedsService {
  constructor(
    private readonly repository: EmbedsRepository,
    private readonly eventTypes: EmbedPublicEventReader,
    private readonly hostProfiles: EmbedPublicProfileReader,
  ) {}

  listAllowedOrigins() {
    return this.repository.listAllowedOrigins();
  }

  replaceAllowedOrigins(origins: string[]) {
    return this.repository.replaceAllowedOrigins(origins);
  }

  async isOriginAllowed(parentOrigin: string) {
    return (await this.repository.listAllowedOrigins()).includes(parentOrigin);
  }

  async canEmbed(handle: string, slug: string, parentOrigin: string) {
    const [profile, event, origins] = await Promise.all([
      this.hostProfiles.getPublicProfile(handle),
      this.eventTypes.getPublicEvent(slug),
      this.repository.listAllowedOrigins(),
    ]);
    return Boolean(profile && event && origins.includes(parentOrigin));
  }
}

export function normaliseEmbedOrigin(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  const loopbackHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopbackHttp) return undefined;
  return parsed.origin === value ? parsed.origin : undefined;
}
