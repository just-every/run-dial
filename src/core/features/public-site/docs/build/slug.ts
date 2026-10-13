// Heading ids the way GitHub makes them, so a link written for GitHub (README.md#some-heading) works on the site too:
// lowercase, drop every character that is not a letter, mark, number, connector, space or hyphen, then spaces become
// hyphens. A repeated slug gets -1, -2 and so on. Make one slugger per rendered document: the counts are per page.
export function createSlugger() {
  const occurrences = new Map<string, number>();
  return (text: string) => {
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    let slug = base;
    while (occurrences.has(slug)) {
      const count = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, count);
      slug = `${base}-${count}`;
    }
    occurrences.set(slug, 0);
    return slug;
  };
}
