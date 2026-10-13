// Where the shared header and footer link. The docs are this site's own pages; the repository and the credit are outbound
// navigation only: no page loads anything from them.

/** The repository's web address, taken from package.json `repository` by vite.config.ts at build time. */
declare const __DIAL_SOURCE_URL__: string;

export const sourceUrl = __DIAL_SOURCE_URL__;
export const creditUrl = "https://runeditrun.com";
