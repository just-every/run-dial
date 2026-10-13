// Native imported records use the existing product table policy. Capture facts
// (capture times, old scheduling links, differences and decisions) are native and
// travel; the private plans and pages that produced them stay on the original install.
export const importExported = ["move_in_targets", "move_in_captures", "move_in_source_links", "move_in_differences", "ik_d1_erased_sources", "ik_d1_erased_targets", "ik_d1_erasure_journal", "ik_d1_retirements"];
export { importExcluded } from "../../src/core/shared/archive-exclusions.mjs";
