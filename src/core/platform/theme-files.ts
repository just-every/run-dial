/** The files the installer and Base's sign-in pages theme themselves with. They live in public/ and are served at these paths. */
const themeFiles = new Set(["/rer-theme.css", "/rer-mark.svg", "/fonts/figtree-latin-wght-normal.woff2"]);

export const isThemeFile = (request: Request) => request.method === "GET" && themeFiles.has(new URL(request.url).pathname);
