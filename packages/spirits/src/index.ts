/**
 * spirits extension entry point.
 *
 * M1 registers the persistent TypeScript REPL tool `tsrepl`. Further host functions and
 * phases plug into the REPL through the host function registry.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTsrepl } from "./tools.ts";

export default function spiritsExtension(pi: ExtensionAPI): void {
	registerTsrepl(pi);
}
