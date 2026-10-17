// Where the shared header and footer link. The docs are this site's own pages; the repository and the credit are outbound
// navigation only: no page loads anything from them.

/** The repository's web address, taken from package.json `repository` by vite.config.ts at build time. */
declare const __DIAL_SOURCE_URL__: string;

export const sourceUrl = __DIAL_SOURCE_URL__;
export const creditUrl = "https://runeditrun.com";
/** The run site's contract page: every clause of the product target and how far the code has come. */
export const contractPath = "/contract";
