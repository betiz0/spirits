/**
 * One process in the concurrent settings write test: merge its own key into the file `count` times.
 *
 * It uses the production writer, so the test measures the real lock procedure rather than a
 * simplified copy of it.
 */

import { patchSettingsFile } from "../../src/commands/settings-store.ts";

const [path, key, countArg] = process.argv.slice(2);
if (!path || !key) {
	console.error("usage: settings-writer-child.ts <settings-path> <key> [count]");
	process.exit(2);
}
const count = Number(countArg ?? "20");
for (let index = 0; index < count; index++) {
	patchSettingsFile({ settingsPath: path, fields: { [key]: "done" } });
}
process.exit(0);
