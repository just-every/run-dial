import mappings from './case-fold-data.json' with { type: 'json' };

/** Full default Unicode case folding for literal search and purchaser identity. */
export function foldCase(value) {
  return Array.from(value, character => mappings[character.codePointAt(0)] ?? character).join('');
}
