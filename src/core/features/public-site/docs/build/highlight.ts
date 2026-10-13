import hljs from 'highlight.js/lib/core.js';
import bash from 'highlight.js/lib/languages/bash.js';
import css from 'highlight.js/lib/languages/css.js';
import diff from 'highlight.js/lib/languages/diff.js';
import ini from 'highlight.js/lib/languages/ini.js';
import javascript from 'highlight.js/lib/languages/javascript.js';
import json from 'highlight.js/lib/languages/json.js';
import plaintext from 'highlight.js/lib/languages/plaintext.js';
import shell from 'highlight.js/lib/languages/shell.js';
import sql from 'highlight.js/lib/languages/sql.js';
import typescript from 'highlight.js/lib/languages/typescript.js';
import xml from 'highlight.js/lib/languages/xml.js';
import yaml from 'highlight.js/lib/languages/yaml.js';

// Code blocks are highlighted once, at build time, with the languages the docs use or are likely to. The output is
// class-only spans (hljs-keyword, hljs-comment, ...) that docs.css draws in ink; nothing ships to the Worker or browser.
const languages = { bash, css, diff, ini, javascript, json, plaintext, shell, sql, typescript, xml, yaml };
for (const [name, language] of Object.entries(languages)) hljs.registerLanguage(name, language);
hljs.registerAliases(['sh', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['text', 'txt'], { languageName: 'plaintext' });

/** Highlighted HTML for a registered language (hljs escapes the text), or null to render the block as plain text. */
export function highlight(code: string, language: string) {
  if (!language || !hljs.getLanguage(language)) return null;
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}
