/**
 * Read-only compatibility checks against a redacted copy of an existing agent directory.
 */

import { cp } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Snapshot read from a redacted agent dir. */
export interface AgentDirSnapshot {
	settings: boolean;
	auth: boolean;
	sessions: string[];
	extensions: string[];
}

/** Read the file names and JSON keys without returning secrets. */
export function readAgentDirSnapshot(agentDir: string): AgentDirSnapshot {
	const settingsPath = join(agentDir, "settings.json");
	const authPath = join(agentDir, "auth.json");
	let settings = false;
	let auth = false;
	if (existsSync(settingsPath)) {
		const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
		settings = Object.keys(parsed).length > 0;
	}
	if (existsSync(authPath)) {
		const parsed = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
		auth = Object.keys(parsed).length > 0;
	}
	const sessionsDir = join(agentDir, "sessions");
	const extensionsDir = join(agentDir, "extensions");
	return {
		settings,
		auth,
		sessions: existsSync(sessionsDir) ? readdirSync(sessionsDir) : [],
		extensions: existsSync(extensionsDir) ? readdirSync(extensionsDir) : [],
	};
}

/** The read result, separate from any write claim. */
export function classifyRead(snapshot: AgentDirSnapshot): { state: "confirmed" | "limited"; detail: string } {
	const complete = snapshot.settings && snapshot.auth && snapshot.sessions.length > 0;
	return complete
		? { state: "confirmed", detail: "settings, auth, sessions, and extensions were readable" }
		: { state: "limited", detail: "some existing data was absent from the redacted fixture" };
}

/** A write that would need a destructive conversion is always aborted in this change. */
export function classifyWrite(operation: { requiresConversion: boolean }): {
	state: "limited" | "not-run";
	detail: string;
} {
	if (operation.requiresConversion) {
		return {
			state: "limited",
			detail: "aborted: the write requires a destructive conversion; write compatibility is not confirmed",
		};
	}
	return { state: "not-run", detail: "write compatibility was not tested; read success does not confirm it" };
}

/** Copy a redacted fixture tree into a temporary agent dir without touching the source. */
export async function copyRedactedAgentFixture(source: string, target: string): Promise<void> {
	await cp(source, target, { recursive: true });
}
