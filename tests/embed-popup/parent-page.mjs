/** A separate site embeds the served script without copying any bootstrap code. */
export function parentPage(origin, duplicate = false) {
  const query = new URLSearchParams({ name: "Synthetic popup invitee", email: `synthetic-dial-popup${String.fromCharCode(64)}example.test`, utm_source: "synthetic-dial-campaign" });
  const script = `<script async src="${origin}/embed/dial.js?${query}" data-dial-handle="dial-host" data-dial-embed="intro" data-dial-mode="popup"></script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic parent site</title><style>body{margin:24px;font:16px system-ui;color:#172a25;background:#f8f7f2}button{font:inherit}h1{font-size:24px}</style></head><body><main><h1>Book a conversation</h1><p>This is a separate synthetic parent site.</p><button id="outside" type="button">Other page action</button></main><script>window.popupEvents=[];window.addEventListener('dial:booked',event=>{window.popupEvents.push(event.detail);window.recordPopupEvent?.(event.detail)});</script>${script}${duplicate ? script : ""}</body></html>`;
}
