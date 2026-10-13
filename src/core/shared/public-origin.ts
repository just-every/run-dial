/** A shareable install origin must never carry credentials or an application path. */
export function installPublicOrigin(value: string) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_URL must be an HTTPS install origin, or a loopback HTTP origin for local use.");
  }
  return url.origin;
}
