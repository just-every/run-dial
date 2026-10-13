type MailUrlResult = { href: string } | { error: string };

/** Host-supplied location facts need not qualify as active web actions. */
export function mailJoinActions(value: string | null | undefined) {
  if (!value) return [];
  const result = inspectMailUrl(value);
  return "href" in result ? [{ label: "Join session", href: result.href }] : [];
}

/** Trusted actions fail closed using the same eligibility rules as optional Join actions. */
export function validateMailUrl(value: string) {
  const result = inspectMailUrl(value);
  if ("error" in result) throw new TypeError(result.error);
  return result.href;
}

function inspectMailUrl(value: string): MailUrlResult {
  if ([...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  })) return { error: "Mail action URL contains a control character" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { error: "Mail action URL must be absolute" };
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    return { error: "Mail action URL must use HTTP or HTTPS without embedded credentials" };
  }
  return { href: url.href };
}
