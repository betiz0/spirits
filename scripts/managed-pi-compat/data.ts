/**
 * Data compatibility classification for the dedicated Pi runtime path.
 *
 * The runner no longer reads the agent dir with Node. The probe extension reads settings and
 * sessions through `pi.getSettings()` / `ctx.sessionManager.getEntries()`, writes through
 * `pi.appendEntry()` / `pi.setModel()` / `pi.setThinkingLevel()`, and reads the values back. A
 * settings persistent write is `not-run` when the extension API does not expose one; Node file
 * writes are never a substitute.
 */

import { cp, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompatState } from "./runner.ts";

/** Settings and session evidence reported by the dedicated Pi. */
export interface DedicatedReadObservation {
	settingsKeys: readonly string[];
	sessionEntries: number;
}

/** Classify the read result from the dedicated Pi. */
export function classifyDedicatedRead(observation: DedicatedReadObservation): {
	state: "confirmed" | "limited" | "not-run";
	detail: string;
} {
	if (observation.settingsKeys.length === 0 && observation.sessionEntries === 0) {
		return { state: "not-run", detail: "the dedicated Pi reported no settings or sessions" };
	}
	if (observation.settingsKeys.length === 0) {
		return { state: "limited", detail: "settings were not readable through the dedicated Pi" };
	}
	return {
		state: "confirmed",
		detail: `read ${observation.settingsKeys.length} settings keys and ${observation.sessionEntries} session entries through the dedicated Pi`,
	};
}

/** Write evidence reported by the dedicated Pi. */
export interface DedicatedWriteObservation {
	sessionWritten: boolean;
	sessionReadBack: boolean;
	modelChanged: boolean;
	thinkingLevelChanged: boolean;
}

/** Classify the write result from the dedicated Pi. */
export function classifyDedicatedWrite(observation: DedicatedWriteObservation): {
	state: "confirmed" | "limited" | "not-run";
	detail: string;
} {
	if (!observation.sessionWritten && !observation.modelChanged && !observation.thinkingLevelChanged) {
		return { state: "not-run", detail: "no write was performed through the dedicated Pi" };
	}
	const problems: string[] = [];
	if (observation.sessionWritten && !observation.sessionReadBack) {
		problems.push("the session write was not read back");
	}
	if (!observation.sessionWritten) problems.push("no session write was performed");
	if (!observation.modelChanged) problems.push("the model was not changed");
	if (!observation.thinkingLevelChanged) problems.push("the thinking level was not changed");
	if (problems.length > 0) return { state: "limited", detail: problems.join("; ") };
	return {
		state: "confirmed",
		detail: "session, model, and thinking level were written and read back through the dedicated Pi",
	};
}

/** Provider auth status as the dedicated Pi runtime reports it. */
export interface AuthStatusEvidence {
	configured: boolean;
	source?: string;
}

/**
 * Classify the auth read. `stored` is a provider whose credential exists only in the copied agent
 * dir; `control` is a provider with no entry anywhere. The read is confirmed when the runtime
 * reports the stored credential as configured from stored credentials while the control stays
 * unconfigured, because that difference can only come from the copied `auth.json`.
 */
export function classifyAuthRead(observation: {
	stored?: AuthStatusEvidence;
	control?: AuthStatusEvidence;
}): { state: CompatState; detail: string } {
	const stored = observation.stored;
	if (stored === undefined) {
		return { state: "not-run", detail: "the dedicated Pi reported no provider auth status" };
	}
	if (!stored.configured) {
		return {
			state: "limited",
			detail: "the dedicated Pi did not resolve the credential copied into the isolated agent dir",
		};
	}
	if (stored.source !== "stored") {
		return {
			state: "limited",
			detail: `the dedicated Pi resolved the credential from ${stored.source ?? "nowhere"}, not from the copied agent dir`,
		};
	}
	if (observation.control?.configured === true) {
		return { state: "limited", detail: "the control provider reported credentials, so the read is not isolated" };
	}
	return {
		state: "confirmed",
		detail: "the dedicated Pi resolved the credential copied into the isolated agent dir (source: stored)",
	};
}

/**
 * Classify the external-extension read. The extension sits in the copied agent dir and registers a
 * command; seeing that command through the dedicated Pi means the runtime read the extension.
 */
export function classifyExternalExtensionRead(observation: {
	commandObserved: boolean;
	commandName: string;
}): { state: CompatState; detail: string } {
	return observation.commandObserved
		? { state: "confirmed", detail: `the extension copied into the agent dir registered /${observation.commandName}` }
		: {
				state: "not-run",
				detail: `the dedicated Pi reported no /${observation.commandName} from the extension copied into the agent dir`,
			};
}

/**
 * Write-back compatibility stays `not-run` until a write through the dedicated Pi is proven to land
 * in an existing agent dir copy. The dedicated Pi write path is a separate item.
 */
export function classifyWriteBackCompatibility(observation: { proven: boolean; detail?: string }): {
	state: CompatState;
	detail: string;
} {
	if (observation.proven) {
		return { state: "confirmed", detail: observation.detail ?? "a write landed in the existing agent dir copy" };
	}
	return {
		state: "not-run",
		detail:
			observation.detail ??
			"no observation proves a dedicated-Pi write landing in an existing agent dir; the dedicated Pi write path is a separate item",
	};
}

/** Agent dir copied from the redacted fixture, shipped next to this module. */
export const REDACTED_AGENT_FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "redacted-agent");

/**
 * Copy the redacted existing agent dir into the isolated agent dir so the dedicated Pi reads it as
 * its own storage. Existing files keep their bytes: the seed adds fixture content, it never
 * replaces what a previous item already wrote.
 */
export async function seedRedactedAgentFixture(agentDir: string): Promise<string[]> {
	await cp(REDACTED_AGENT_FIXTURE_DIR, agentDir, { recursive: true, force: false, errorOnExist: false });
	const files: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await walk(path);
			else files.push(resolve(path));
		}
	};
	await walk(agentDir);
	return files;
}

/** Settings persistent-write evidence. */
export interface SettingsWriteObservation {
	/** True when the extension API exposed a persistent settings write. */
	available: boolean;
	/** True when the write was performed and read back. */
	written?: boolean;
	error?: string;
}

/** Classify the settings write; an unavailable API is `not-run`, never a Node file write. */
export function classifySettingsWrite(observation: SettingsWriteObservation): {
	state: CompatState;
	detail: string;
} {
	if (!observation.available) {
		return {
			state: "not-run",
			detail: "the Pi extension API does not expose a persistent settings write; Node file writes are not a substitute",
		};
	}
	if (observation.error) {
		return { state: "failed", detail: `settings write failed: ${observation.error}` };
	}
	if (observation.written === true) {
		return { state: "confirmed", detail: "settings were written and read back through the dedicated Pi" };
	}
	return { state: "limited", detail: "the settings write was not confirmed" };
}
