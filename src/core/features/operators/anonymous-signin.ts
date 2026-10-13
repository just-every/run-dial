import { AuthError } from "../../../../modules/operator-auth/index.mjs";

/** Base retires failed delivery tokens; the anonymous response must not reveal
 * whether an address caused a send. Missing configuration remains a failure. */
export async function anonymousMagicLinkRequest(send: () => Promise<unknown>, mailConfigured: () => boolean) {
  try {
    await send();
  } catch (error) {
    if (!(error instanceof AuthError) || error.code !== "mail_unavailable" || error.status !== 503 || !mailConfigured()) throw error;
  }
}
