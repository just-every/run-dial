import { plainLook } from "../site-look";
import type { ProfileRecord } from "./repository";

export type PublicProfileRecord = Pick<
  ProfileRecord,
  "handle" | "name" | "title" | "biography" | "timezone" | "focusAreas" | "socialProof" | "avatarKey" | "look"
>;

export function toPublicProfile(profile: ProfileRecord): PublicProfileRecord {
  return {
    avatarKey: profile.avatarKey,
    look: profile.look ?? plainLook,
    handle: profile.handle,
    name: profile.name,
    title: profile.title,
    biography: profile.biography,
    timezone: profile.timezone,
    focusAreas: profile.focusAreas,
    socialProof: profile.socialProof,
  };
}
