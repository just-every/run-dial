// highlight.js 10 ships types for its package root only; its core and language files are typed here.
declare module 'highlight.js/lib/core.js' {
  import hljs from 'highlight.js';
  export default hljs;
}
declare module 'highlight.js/lib/languages/*.js' {
  import type { LanguageFn } from 'highlight.js';
  const language: LanguageFn;
  export default language;
}
