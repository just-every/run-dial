import { ProviderFailure } from "../calendar/types";
import { isSendGridSenderVerified } from "./sendgrid-readiness";

/** Credential/sender read only; never delivers a test message. */
export async function checkMailProvider(config: { provider: "resend" | "sendgrid"; apiKey?: string; from?: string }, request: typeof fetch) {
  if (!config.apiKey || !config.from) throw new ProviderFailure("missing_configuration", false);
  const domain = /^[^\s@]+@([^\s@]+)$/.exec(config.from)?.[1];
  if (!domain) throw new ProviderFailure("invalid_delivery_payload", false);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(new ProviderFailure("provider_timeout", true)); }, 10_000);
  });
  const read = async (url: string): Promise<unknown> => {
    controller.signal.throwIfAborted();
    return Promise.race([expired, (async () => {
      // Workers supports manual redirects; the status check below refuses them.
      const response = await request(url, { headers: { authorization: `Bearer ${config.apiKey}` }, signal: controller.signal, redirect: "manual" });
      if (!response.ok) throw new ProviderFailure(response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : "provider_unavailable", response.status >= 500);
      return response.json();
    })()]);
  };
  try {
    const verified = config.provider === "sendgrid"
      ? await isSendGridSenderVerified(config.from, domain, read)
      : ((await read("https://api.resend.com/domains")) as { data?: { name?: string; status?: string }[] }).data?.some((item) => item.name === domain && item.status === "verified");
    if (!verified) throw new ProviderFailure("forbidden", false);
    return { checkedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure(controller.signal.aborted ? "provider_timeout" : "provider_unavailable", true);
  } finally { clearTimeout(timeout); }
}
