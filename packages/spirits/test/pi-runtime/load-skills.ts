/**
 * Re-export pi's skill loader for tests outside `test/pi-runtime/`.
 *
 * A bare `@earendil-works/pi-coding-agent` import resolves through the nearest
 * `tsconfig.json` of the importing file. This file sits in `test/pi-runtime/`, whose
 * config extends the repo root and points at the pi sources, so importing this helper
 * from `test/bundled-skills.test.ts` gets the source implementation rather than the
 * prebuilt `dist` (which is not present in CI).
 */

export { formatSkillsForPrompt, loadSkills } from "@earendil-works/pi-coding-agent";
