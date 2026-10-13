import mappings from './case-fold-data.json' with { type: 'json' };

/** Full default Unicode case folding; punctuation is always literal. */
export function foldBookingSearch(value) {
  return Array.from(value, character => mappings[character.codePointAt(0)] ?? character).join('');
}
