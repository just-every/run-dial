import { useEffect } from 'react';

/**
 * In `vite dev`, reloads a docs page that was served before the Markdown last changed. A change made while the page is
 * loading sends its reload before the page is listening, so the page compares its version with the docs as they are now.
 */
export function useCurrentDocs(version: number) {
  useEffect(() => {
    if (!import.meta.hot) return;
    void import('virtual:dial-docs').then(docs => {
      if (docs.version !== version) location.reload();
    });
  }, [version]);
}
