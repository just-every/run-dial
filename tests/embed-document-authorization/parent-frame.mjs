import vm from "node:vm";

/** Runs the served embed bootstrap against a minimal DOM and records what the parent page does for dial:booked messages. */
export function parentFrame(bootstrap, scriptSrc) {
  const order = [], listeners = [], frame = { contentWindow: {}, style: {} };
  const script = { src: scriptSrc, dataset: { dialHandle: "dial-host", dialEmbed: "intro", dialMode: "inline" }, insertAdjacentElement: () => {} };
  const window = {
    location: { origin: "https://allowed.example.test", href: "https://allowed.example.test/page", assign: href => order.push(["assign", href]) },
    addEventListener: (type, listener) => { if (type === "message") listeners.push(listener); },
    dispatchEvent: event => order.push(["event", event.type]),
  };
  const document = { currentScript: script, readyState: "complete", querySelectorAll: () => [], createElement: () => frame };
  vm.runInNewContext(bootstrap, { window, document, URL, URLSearchParams, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }, HTMLElement: class {}, HTMLButtonElement: class {}, HTMLAnchorElement: class {} });
  const message = (data, from = {}) => listeners.forEach(listener => listener({ origin: new URL(scriptSrc).origin, source: frame.contentWindow, ...from, data }));
  return {
    order,
    booked: (bookingReference, redirectUrl, from) => message({ type: "dial:booked", bookingReference, ...(redirectUrl === undefined ? {} : { redirectUrl }) }, from),
    foreign: () => ({ origin: "https://elsewhere.example.test" }),
    stranger: () => ({ source: {} }),
  };
}
