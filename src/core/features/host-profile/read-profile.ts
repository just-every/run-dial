import { errorMessage } from "../../api/client";
import type { ProfileRecord } from "./repository";

/** Successful null means the authenticated host singleton is not configured. */
export async function readProfile(response: { ok: boolean; json(): Promise<unknown> }): Promise<ProfileRecord | null> {
  if (response.ok) return await response.json() as ProfileRecord | null;
  throw new Error(await errorMessage(response));
}
