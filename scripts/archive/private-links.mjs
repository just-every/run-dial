import { StreamHash, utf8 } from '@runeditrun/rer/internal/modules/portability/hash.mjs';
function tokenHash(value) {
 const hash = new StreamHash(); hash.update(utf8(value));
 return btoa(String.fromCharCode(...hash.digest().match(/../g).map(byte => parseInt(byte, 16)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
// Match candidate URLs, then inspect their route and credential material. A
// documentation path named /manage or /auth/confirm is not itself authority.
const candidates = /https?:\/\/[^\s<>"']+|\/[^\s<>"']+/g;
const opaque = /^[A-Za-z0-9_-]{32,}$/; // Includes every generated 256-bit Dial/Base token.
export function privateLinks(text, { known = [], hashes = new Set(), trusted = false } = {}) {
  const links = [];
  for (const match of text.matchAll(candidates)) {
    const link = match[0].replace(/[.,);!\]}]+$/, '');
    try {
      const url = new URL(link, 'https://archive.invalid');
      const manage = /^\/(?:embed\/|api\/public\/)?manage\/([^/]+)(?:\/|$)/.exec(url.pathname);
      const authentication = /^\/(?:api\/)?auth\/(?:confirm|verify|owner-signin)$/.test(url.pathname);
      const bookingLink = /^\/(?:book\/|api\/public\/(?:book|events)\/)/.test(url.pathname) && url.searchParams.has('link');
      const raw = manage?.[1] ?? (bookingLink ? url.searchParams.get('link') : url.searchParams.get('token'));
      if (!raw) continue;
      const token = manage ? decodeURIComponent(raw) : raw;
      if (!manage && !bookingLink && !authentication && !url.pathname.endsWith('/confirmed')) continue;
      // A supplied token parameter on an authentication route is explicit
      // credential material. Known/persisted manage tokens have no size cutoff.
      const persisted = manage && known.some(salt => hashes.has(tokenHash(`${salt}:${token}`)));
      if (!trusted && !authentication && !opaque.test(token) && !known.includes(token) && !persisted) continue;
      links.push({ link, token, index: match.index });
    } catch { /* malformed URLs carry no parsed capability; known bytes still scan */ }
  }
  return links;
}
export function scrubPrivateLinks(text, secrets) {
  const links = privateLinks(text, { known: secrets });
  let result = text;
  for (const { link, index } of links.reverse()) result = result.slice(0, index) + '[private-link-removed]' + result.slice(index + link.length);
  return result;
}
