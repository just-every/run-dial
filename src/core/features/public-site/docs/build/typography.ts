// Prose quotes the way the landing writes them: ’ for an apostrophe and a closing quote, ‘ and “ to open a quotation.
// Code keeps its straight quotes, since a reader copies it.

type Node = { type: string; tagName?: string; value?: string; children?: Node[] };

/** A quote opens a quotation at the start of the text or after a space, an opening bracket or a dash. */
const opensAfter = /^$|[\s([{–—-]/u;

function curl(value: string, before: string) {
  let previous = before;
  let result = '';
  for (const character of value) {
    if (character === "'") result += opensAfter.test(previous) ? '‘' : '’';
    else if (character === '"') result += opensAfter.test(previous) ? '“' : '”';
    else result += character;
    previous = character;
  }
  return result;
}

/** Curls the quotes in every text node outside code, reading each quote's left neighbour across element boundaries. */
export function typeset(node: Node, previous = { character: '' }) {
  for (const child of node.children ?? []) {
    if (child.type === 'text' && child.value) {
      const original = child.value;
      child.value = curl(original, previous.character);
      previous.character = original.at(-1)!;
    } else if (child.tagName === 'code' || child.tagName === 'pre') previous.character = 'x';
    else typeset(child, previous);
  }
}
