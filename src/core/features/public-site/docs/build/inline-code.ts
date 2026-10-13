import { createElement } from 'react';
import type { ReactNode } from 'react';

// Inline code never breaks inside a flag, an error code or a name. A short word stays on one line, and so does a short
// phrase such as `pnpm run dev`, kept small enough to fit beside a numbered step on a 320px screen. Anything longer wraps
// at its spaces. A word wraps inside only when it is long, or when it is a path (it has a slash) of 20 characters or
// more such as `/api/calendar/oauth/callback`: then after a slash, a dot or an underscore, or before a query, so the
// punctuation ends a line and no piece too short to stand alone starts or ends one. A URL's scheme stays attached to the
// start of its host. A host and port under 20 characters such as `127.0.0.1:8787` stays whole; a longer one wraps after
// its dots, except inside a `<placeholder>`.

const short = 30;
const shortPhrase = 16;
const shortPath = 20;
const shortAuthority = 20;
const pieceMinimum = 4;
const breakPoints = /(?<=\/)(?!\/)|(?<=\.)(?=[^.])|(?<=_)(?=[^_])|(?=[?&])/;
const authorityBreaks = /(?<=\.)(?=[^.])(?![^<>]*>)/;
const urlStart = /^([a-z][a-z\d+.-]*:\/\/)([^/?#]*)(\/?)/i;

const breaksInside = (word: string) => word.length > short || (word.includes('/') && word.length >= shortPath);

/** Pieces with any piece too short to stand on a line joined to its neighbour. */
function joinShort(parts: string[]) {
  const joined: string[] = [];
  for (const part of parts) {
    if (joined.length && joined.at(-1)!.length < pieceMinimum) joined[joined.length - 1] += part;
    else joined.push(part);
  }
  if (joined.length > 1 && joined.at(-1)!.length < pieceMinimum) joined.splice(-2, 2, joined.at(-2)! + joined.at(-1)!);
  return joined;
}

/** The word split at its break points: a URL's scheme joins its host, and the host splits only when it is long. */
function splitAtBreakPoints(word: string) {
  const url = word.match(urlStart);
  if (!url) return word.split(breakPoints);
  const [head, scheme, authority, slash] = url;
  const host = authority.length < shortAuthority ? [authority] : joinShort(authority.split(authorityBreaks));
  host[0] = scheme + host[0];
  host[host.length - 1] += slash;
  return [...host, ...word.slice(head.length).split(breakPoints)];
}

/** A long word's pieces between its break points. */
const pieces = (word: string) => (breaksInside(word) ? joinShort(splitAtBreakPoints(word)) : [word]);

export function inlineCode(text: string) {
  const whole = /\s/.test(text) ? text.length <= shortPhrase : !breaksInside(text);
  if (whole) return createElement('code', { className: 'docs-code-line' }, text);
  const children: ReactNode[] = [];
  for (const token of text.split(/(\s+)/)) {
    if (!token) continue;
    if (/^\s/.test(token)) { children.push(token); continue; }
    pieces(token).forEach((piece, index) => {
      if (index) children.push(createElement('wbr', { key: `${children.length}-break` }));
      children.push(createElement('span', { key: children.length }, piece));
    });
  }
  return createElement('code', { className: 'docs-code-words' }, ...children);
}
