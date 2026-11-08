/** Decorate already-authorized embed documents without changing their projection. */
export function withEmbedKeyboard(response: Response) {
  if (!response.headers.get("Content-Type")?.includes("text/html")) return response;
  return new HTMLRewriter().on("head", {
    element(element) {
      element.append('<script defer src="/embed/dial.js" data-dial-keyboard="true"></script>', { html: true });
    },
  }).transform(response);
}
