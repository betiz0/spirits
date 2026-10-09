/**
 * spirits extension entry point.
 *
 * M1 registers the persistent TypeScript REPL tool `tsrepl`. M3 adds the `rlm` host function,
 * which lets cells start child agent sessions through the same host function registry.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_DEPTH } from "./rlm/depth.ts";
import { createRlmHostFn } from "./rlm/hostfn.ts";
import { spawnChildSession } from "./rlm/spawn.ts";
import { registerTsrepl } from "./tools.ts";

export default function spiritsExtension(pi: ExtensionAPI): void {
	const rlm = createRlmHostFn({ pi, depth: 0, maxDepth: DEFAULT_MAX_DEPTH, spawn: spawnChildSession });
	registerTsrepl(pi, { hostFns: [rlm] });
}
