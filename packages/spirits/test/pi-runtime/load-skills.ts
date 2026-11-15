/**
 * pi's skill loader re-exported for the tests that need it.
 *
 * The bare specifier resolves to the pinned host package installed under `packages/spirits/node_modules`
 * — the same entity `tsc` type-checks against — so a test outside `test/pi-runtime/` gets pi's own
 * implementation by importing this helper.
 */

export { formatSkillsForPrompt, loadSkills } from "@earendil-works/pi-coding-agent";
