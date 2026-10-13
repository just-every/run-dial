import type { HostProfileRepository, ProfileInput } from "./repository";

export class HostProfileService {
  constructor(private readonly repository: HostProfileRepository) {}

  getProfile() {
    return this.repository.get();
  }

  getPublicProfile(handle: string) {
    return this.repository.getByHandle(handle);
  }

  async getHostTimezone() {
    return (await this.repository.get())?.timezone;
  }

  saveProfile(input: ProfileInput) {
    return this.repository.upsert(input);
  }
}
