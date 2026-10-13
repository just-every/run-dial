// Shared feature exports are reachable from the browser route tree. Construct
// persistence and storage services directly in the server's app composition.
export type { HostProfileService } from "./service";
export type { HostProfileRepository } from "./repository";
export { toPublicProfile } from "./public";
export { readProfile } from "./read-profile";
export type { ProfileInput, ProfileRecord } from "./repository";
export type { PublicProfileRecord } from "./public";

export { HostAvatar } from "./ui/host-avatar";
