// Screen decoded JSON string tokens, including JSON serialized inside strings.
// Per active serialization layer retain only four hex digits and the longest
// credential overlap; no token/document is buffered and bytes are never rewritten.
export function jsonSecretScanner(secrets) {
  if (!secrets.length) return () => {};
  const decoder = new TextDecoder();
  const overlap = secrets.reduce((maximum, value) => Math.max(maximum, value.length - 1), 0);
  const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
  function layer() {
    const special = /["\\]/g;
    let mode = 'outside'; let hex = ''; let tail = ''; let nested;
    function decoded(value) {
      const text = tail + value;
      if (secrets.some(secret => text.includes(secret))) throw new Error('archive-object-contains-credential');
      tail = overlap ? text.slice(-overlap) : '';
      // A decoded quoted token can itself carry structured JSON. Feed only new
      // characters to its own lexer; sibling tokens never share lexer state.
      nested ??= layer(); nested(value);
    }
    return text => {
      for (let offset = 0; offset < text.length;) {
        if (mode === 'outside') {
          const quote = text.indexOf('"', offset);
          if (quote < 0) break;
          offset = quote + 1; mode = 'string'; tail = ''; nested = undefined;
        } else if (mode === 'string') {
          special.lastIndex = offset;
          const next = special.exec(text);
          decoded(text.slice(offset, next?.index ?? text.length));
          if (!next) break;
          offset = next.index + 1;
          mode = next[0] === '"' ? 'outside' : 'escape';
          if (mode === 'outside') nested = undefined;
        } else if (mode === 'escape') {
          const character = text[offset++];
          if (character === 'u') { mode = 'unicode'; hex = ''; }
          else if (Object.hasOwn(escapes, character)) { decoded(escapes[character]); mode = 'string'; }
          else { mode = 'outside'; tail = ''; nested = undefined; }
        } else {
          const character = text[offset++];
          if (!/[a-f\d]/i.test(character)) { mode = 'outside'; tail = ''; nested = undefined; continue; }
          hex += character;
          if (hex.length === 4) { decoded(String.fromCharCode(Number.parseInt(hex, 16))); mode = 'string'; }
        }
      }
    };
  }
  const scan = layer();
  return bytes => scan(decoder.decode(bytes, { stream: true }));
}
