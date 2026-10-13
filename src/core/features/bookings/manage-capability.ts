import { createOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { createId } from "../../shared/ids";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { BookingsRepository } from "./repository";
import type { BookingRecord } from "./types";

const manageTokenLifetimeMs = 90 * 24 * 60 * 60 * 1000;

/** Creates one opaque replacement capability and tombstones every prior active capability. */
export class ManageCapabilityService {
  constructor(
    private readonly repository: BookingsRepository,
    private readonly runtime: RuntimeEnvironment,
  ) {}

  async rotate(booking: BookingRecord) {
    const tokenId = createId();
    const token = createOpaqueToken();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.parse(booking.occurrence.startAt) + manageTokenLifetimeMs).toISOString();
    if (expiresAt <= now) return { kind: "expired" as const };
    await this.repository.rotateManageToken(booking.id, tokenId, await hashToken(token, this.runtime.SESSION_SECRET), expiresAt, now, new URL(`/manage/${token}`, this.runtime.APP_URL).toString());
    return { kind: "rotated" as const, manageUrl: new URL(`/manage/${token}`, this.runtime.APP_URL).toString(), expiresAt };
  }
}
