/**
 * The Dial mark: an ink disc with one rim segment clicked out of it in gold, the hero dial in miniature. The disc takes the colour of
 * the wordmark beside it, so it follows the ink of whichever surface shows it; favicon.svg draws the same two shapes. Decorative:
 * the wordmark next to it names the link.
 */
export function BrandMark() {
  return <svg aria-hidden="true" focusable="false" className="pb-brand-mark" viewBox="1 5 34 34">
    <path fill="currentColor" d="M31.55 19.37A15 15 0 1 1 20.63 8.45L18.69 16.21A7 7 0 0 1 23.79 21.31Z" />
    <path fill="#dcab3c" d="M23.65 6.4A15 15 0 0 1 33.6 16.35L25.95 18.69A7 7 0 0 0 21.31 14.05Z" />
  </svg>;
}
