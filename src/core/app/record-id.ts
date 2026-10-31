/** A record's id as its path carries it: 26 URL-safe characters, the length every record API accepts (ULIDs, and fixed fixture ids). */
export const recordIdPattern = "[0-9A-Za-z_-]{26}";
const recordIdExpression = new RegExp(`^${recordIdPattern}$`);

/** The id when it can name a record, otherwise undefined: the page then says the record was not found. */
export function recordId(id: string | undefined) { return id && recordIdExpression.test(id) ? id : undefined; }
