import { createServer } from "node:http";

/** A second real browser origin: a website with an ordinary form that has no knowledge of Dial beyond one script tag. */
export const parentOrigin = "http://localhost:15803";
const escape = value => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function startParent(dialOrigin) {
  const received = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, parentOrigin);
    if (url.pathname === "/received") {
      // The site's own handling of its form: always acknowledged, never changed by Dial.
      request.resume();
      request.on("end", () => { received.push(url.searchParams.get("tag")); response.writeHead(204).end(); });
      return;
    }
    const routing = url.searchParams.get("routing") ?? "", map = url.searchParams.get("map") ?? "[]";
    const script = `<script src="${dialOrigin}/api/public/external-routing/dial-form.js" data-dial-form="#contact" data-dial-routing="${escape(routing)}" data-dial-map="${escape(map)}"></script>`;
    const mounts = Number(url.searchParams.get("mounts") ?? 1);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Contact the studio</title>
<style>body{font:16px/1.5 system-ui;margin:0;padding:24px;color:#1d1c1a}form{display:grid;gap:12px;max-width:420px}label{display:grid;gap:4px}input,select,textarea,button{font:inherit;min-height:44px;padding:0 8px}textarea{min-height:88px}</style></head>
<body><main><h1>Contact the studio</h1>
<form id="contact" method="post" action="/received?tag=${escape(url.searchParams.get("tag") ?? "site")}">
<label>Full name<input name="full_name" autocomplete="name"></label>
<label>Work email<input name="work_email" type="email" autocomplete="email"></label>
<label>What do you need?<select name="topic"><option value="consult">A consultation</option><option value="other">Something else</option></select></label>
<label>Company<input name="company"></label>
<label>Goal<input name="goal"></label>
<label>Unmapped note<textarea name="note"></textarea></label>
<label>Secret<input name="secret" type="password"></label>
<button type="submit">Send</button></form></main>
${Array.from({ length: mounts }, () => script).join("\n")}
<script>window.dialEvents=[];for(const type of ["dial:routing-opened","dial:routing-refused"])window.addEventListener(type,event=>window.dialEvents.push({type,code:event.detail.code}));</script>
</body></html>`);
  });
  return new Promise(done => server.listen(15803, "127.0.0.1", () => done({ received, close: () => new Promise(closed => { server.close(closed); server.closeAllConnections(); }) })));
}
