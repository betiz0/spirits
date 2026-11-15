/**
 * pi values re-exported for the tests that need them.
 *
 * One file names them, so the specifier appears once instead of in every test that builds a session or
 * loads a skill. `@earendil-works/pi-coding-agent` resolves to the pinned host package installed under
 * `packages/spirits/node_modules`, for `tsc` and for `bun test` alike, from here and from a test at
 * `test/` level.
 */

export { sessionEntryToContextMessages, SessionManager } from "@earendil-works/pi-coding-agent";
