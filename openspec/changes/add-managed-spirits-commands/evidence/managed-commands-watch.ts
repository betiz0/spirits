/**
 * Extension loaded next to the spirits bundle in `managed-commands-probe.ts`.
 *
 * It owns nothing the product owns. It appends a line per session start and turn end with the
 * settings file as it stands and the settings the runtime was handed, so a write by a command is
 * separable from a later reload, and a reload survives the module being evaluated again.
 */

import { appendFileSync, readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOG = process.env.CX_WATCH_LOG;
const AGENT = process.env.SPIRITS_CODING_AGENT_DIR;

export default function watchExtension(pi: ExtensionAPI): void {
	const shot = (why: string, effective?: unknown) => {
		if (!LOG || !AGENT) return;
		let file: unknown = null;
		try {
			file = JSON.parse(readFileSync(`${AGENT}/settings.json`, "utf8"));
		} catch (error) {
			file = `unreadable: ${(error as Error).message}`;
		}
		appendFileSync(LOG, `${JSON.stringify({ why, file, effective: effective ?? null })}\n`);
	};

	pi.on("session_start", (_event, ctx) => shot("session_start", ctx.settings));
	pi.on("agent_end", () => shot("agent_end"));
}
