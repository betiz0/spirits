// pi values re-exported for tests outside `pi-runtime/`. A test at `test/` level resolves
// `@earendil-works/pi-coding-agent` through the type mirror in `src/types/`, so a value import there
// fails wherever pi is not built (CI). This file sits under `test/pi-runtime/tsconfig.json`, which
// maps the specifier onto pi's sources, so it can hand the value over.
export { sessionEntryToContextMessages, SessionManager } from "@earendil-works/pi-coding-agent";
