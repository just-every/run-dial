import { foldCase } from '../../../shared/case-fold.mjs';

/** Full default Unicode case folding; punctuation is always literal. */
export function foldBookingSearch(value) {
  return foldCase(value);
}
