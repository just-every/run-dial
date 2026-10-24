import manifest from "../../../../seed.json";

/** BRAND-002: brand file sizes come from seed.json limits: a read mark, and a face (the site's is read for its facts up
 * to this size and never kept; an uploaded one, a later round, is held to it). */
export const brandMarkBytes = manifest.limits.maxBrandMarkBytes;
export const brandFontBytes = manifest.limits.maxBrandFontBytes;
