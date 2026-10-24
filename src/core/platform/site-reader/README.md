# Site reader

Dial's copy of Lamp's rule-based site reader (just-every/run-lamp 195e73ac
`src/core/platform/site-reader`, L5 and L17), held here until Base ships the shared
reader (gr G1); the round that adopts Base's reader deletes this folder. Files copied
unchanged say so in their first line; the others name what Dial changed.

It reads what a public website says about itself, so the booking pages can wear the
host's own look (BRAND-001). Self-contained: standard `fetch` only, no AI, runs in
Workers and Node.

```ts
import { readSite } from "./index.ts";

const result = await readSite("runeditrun.com");
if (result.ok) result.site;   // SiteRead
else result.reason;           // "invalid-url" | "refused-address" | "unreachable" | "timeout" | "http-error" | "not-html"
```

## SiteRead

| Field | From |
|---|---|
| `url`, `host` | The page that answered, after redirects |
| `name` | og:site_name, application-name, manifest or `<title>` part; the one the domain spells wins |
| `title`, `description` | `<title>`; meta description, og:description or manifest description (≤ 280 chars) |
| `icon` | Declared SVG icon first, then the largest declared raster, then `/favicon.ico`; type sniffed from the bytes |
| `colours`, `accent` | theme-color, the SVG mark's own fills, CSS brand/primary/accent properties, pinned-tab colour, manifest theme_color |
| `palette` | The page's own CSS: the body's (else html's) background and text colour, and the first visible link or button it fills with a solid colour other than the page's (its fill and its text). Without such a button the accent is `accent` above. |
| `face` | The first family in the body's font stack (then html's, then h1's) that the site serves with `@font-face`; its regular, upright, Latin file; the family and licence that file names in its own `name` table (13 and 14) |

Nothing is guessed: a field the site does not give is `null` or empty.

Stylesheets: linked sheets in page order (at most 8, each up to 512 KB), then the
page's `<style>` blocks. Only unconditional rules count: `@media`, `@supports` and
nested variant blocks are skipped, `@layer` contents count. Rules are matched through
simple selectors only (a tag, classes, an id or `:root`, optionally under html or body),
with importance, specificity and order, and `var()` resolved through the custom
properties html and body see. Colours: hex, rgb(), hsl(), oklch(), oklab() and named
colours; a translucent colour is not a solid one.

Fonts: TrueType, OpenType, WOFF (zlib) and WOFF2 (Brotli) are read through `node:zlib`;
a font collection is not read. `licence.open` is `OFL` or `Apache-2.0` when the file's
own licence description or URL names one; `source` is `google-fonts` when Google Fonts
serves the face.

## Safety

- http and https only, default ports only, no credentials in the URL; `localhost`, single-label and private-suffix names are refused.
- Before every request, including every redirect hop (at most 5), the host name is resolved and every address must be public. The default resolver is DNS over HTTPS at cloudflare-dns.com, asked once per host per read.
- One deadline for the whole read (10 s by default); HTML is read up to 1.5 MB, a manifest up to 100 KB, an icon up to 300 KB, a font file up to 1 MB.
- The HTML and CSS are scanned as text: no page DOM, no script runs. Serve a read SVG only through `<img>` or sandboxed.
- Limit: the fetch resolves the name again after the check. On Cloudflare Workers outbound requests cannot reach private networks anyway; elsewhere, run behind an egress that refuses them.

Tests: `tests/site-look.test.mjs` reads a local fake site through Dial's own routes.
