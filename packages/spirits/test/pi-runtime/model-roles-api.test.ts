/**
 * Pins the pi half of `/model <model> [level] <role>`: pi keeps the role vocabulary and the settings
 * key an extension registers, cuts the trailing role word with that vocabulary, and hands the role to
 * the registration's callback (add-model-role-setting design Decision 9).
 *
 * If this test fails, pi stopped accepting the registration or stopped calling the extension back, and
 * `/model <model> strong` no longer locks the spirits role.
 */

import { expect, test } from "bun:test";
import {
	discoverAndLoadExtensions,
	ExtensionRunner,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { parseModelCommandArgs } from "@earendil-works/pi-coding-agent/modes/interactive/model-command-args";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODEL_ROLES, SETTINGS_KEY_MODELS, SETTINGS_KEY_ROLE } from "../../src/constants.ts";
import { registerDualModelRouting } from "../../src/routing/register.ts";

/** Extension source that registers the spirits vocabulary and records the callback it receives. */
const RECORDING_EXTENSION = `export default (pi) => {
	pi.registerModelRoles({
		roles: ["normal", "strong"],
		settingsKey: { field: "models", key: "role" },
		onSelect: (role, ctx) => {
			globalThis.spiritsRoleLock = { role, hasSessionManager: !!ctx.sessionManager };
		},
	});
};`;

/** Load one extension source through pi's own discovery, on a runner that owns it. */
async function withRunner(source: string): Promise<{ runner: ExtensionRunner; cleanup: () => Promise<void> }> {
	const cwd = await mkdtemp(join(tmpdir(), "spirits-model-roles-cwd-"));
	const agentDir = await mkdtemp(join(tmpdir(), "spirits-model-roles-agent-"));
	await mkdir(join(agentDir, "extensions"), { recursive: true });
	await writeFile(join(agentDir, "extensions", "roles.ts"), source, "utf8");

	const loaded = await discoverAndLoadExtensions([], cwd, agentDir);
	expect(loaded.errors).toEqual([]);

	const runner = new ExtensionRunner(
		loaded.extensions,
		loaded.runtime,
		cwd,
		SessionManager.inMemory(cwd),
		// An empty catalog is enough: the registration and the callback never resolve a model.
		new ModelRegistry(
			await ModelRuntime.create({
				credentials: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => {} },
				modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} },
				modelsPath: null,
				allowModelNetwork: false,
			}),
		),
	);

	return { runner, cleanup: async () => {
		await rm(cwd, { recursive: true, force: true });
		await rm(agentDir, { recursive: true, force: true });
	} };
}

test("pi keeps the role vocabulary and the settings key spirits registers", async () => {
	// The extension entry point is the real spirits registration, so a registration pi stops accepting
	// fails here rather than in the operator's session.
	const spiritsPath = new URL("../../src/routing/register.ts", import.meta.url).pathname;
	const { runner, cleanup } = await withRunner(
		`import { registerDualModelRouting } from ${JSON.stringify(spiritsPath)};\nexport default (pi) => registerDualModelRouting(pi);`,
	);

	try {
		expect(runner.getModelRoles()?.roles).toEqual([...MODEL_ROLES]);
		expect(runner.getModelRoles()?.settingsKey).toEqual({ field: SETTINGS_KEY_MODELS, key: SETTINGS_KEY_ROLE });
	} finally {
		await cleanup();
	}
});

test("pi cuts the trailing role word and hands it to the registration", async () => {
	delete (globalThis as Record<string, unknown>).spiritsRoleLock;
	const { runner, cleanup } = await withRunner(RECORDING_EXTENSION);

	try {
		const roles = runner.getModelRoles()?.roles ?? [];
		expect(roles).toEqual(["normal", "strong"]);

		// The same call interactive mode makes with the registered vocabulary.
		const parsed = parseModelCommandArgs("anthropic/claude-sonnet-4-5 strong", roles);
		expect({ searchTerm: parsed.searchTerm, role: parsed.role }).toEqual({
			searchTerm: "anthropic/claude-sonnet-4-5",
			role: "strong",
		});

		if (!parsed.role) throw new Error("pi did not cut the role from the /model arguments");
		runner.selectModelRole(parsed.role);

		expect((globalThis as Record<string, unknown>).spiritsRoleLock).toEqual({
			role: "strong",
			hasSessionManager: true,
		});
	} finally {
		await cleanup();
	}
});
