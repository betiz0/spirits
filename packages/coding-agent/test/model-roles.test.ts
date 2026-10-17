/**
 * `pi.registerModelRoles()`: the extension-facing half of the `/model` role argument. pi stores one
 * registration, hands the chosen role back to the extension, and never interprets the value or the
 * settings key it was given.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { parseModelCommandArgs } from "../src/modes/interactive/model-command-args.ts";
import { createInMemoryModelRegistry } from "./model-runtime-test-utils.ts";

/** An extension that registers a role vocabulary and records the callback it receives. */
function roleExtension(vocabulary: string, mark: string): string {
	return `export default (pi) => {
		pi.registerModelRoles({
			roles: ${vocabulary},
			settingsKey: { field: "models", key: ${JSON.stringify(mark)} },
			onSelect: (role, ctx) => {
				globalThis.roleSelection = { role, mark: ${JSON.stringify(mark)}, hasSessionManager: !!ctx.sessionManager };
			},
		});
	};`;
}

/** An empty extension: loaded, but registers no role vocabulary. */
const NO_ROLES = "export default () => {};";

describe("pi.registerModelRoles", () => {
	let tempDir: string;

	/** Load the sources as extensions from the discovered directory, the way a session start does. */
	async function createRunner(...sources: string[]): Promise<ExtensionRunner> {
		const extensionsDir = path.join(tempDir, "extensions");
		fs.rmSync(extensionsDir, { recursive: true, force: true });
		fs.mkdirSync(extensionsDir, { recursive: true });
		sources.forEach((source, index) => {
			fs.writeFileSync(path.join(extensionsDir, `e${index}.ts`), source);
		});

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);
		const modelRegistry = await createInMemoryModelRegistry(AuthStorage.inMemory());
		return new ExtensionRunner(result.extensions, result.runtime, tempDir, SessionManager.inMemory(), modelRegistry);
	}

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-model-roles-"));
		delete (globalThis as any).roleSelection;
	});

	afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

	it("keeps the vocabulary and the settings key of the last registration", async () => {
		const runner = await createRunner(roleExtension('["weak", "strong"]', "first"));

		expect(runner.getModelRoles()?.roles).toEqual(["weak", "strong"]);
		expect(runner.getModelRoles()?.settingsKey).toEqual({ field: "models", key: "first" });

		// An extension reload registers again, and a second extension may replace the vocabulary: only
		// one is active, so the last registration wins.
		const replaced = await createRunner(
			roleExtension('["weak", "strong"]', "first"),
			roleExtension('["only"]', "second"),
		);
		expect(replaced.getModelRoles()?.roles).toEqual(["only"]);
		expect(replaced.getModelRoles()?.settingsKey).toEqual({ field: "models", key: "second" });
	});

	it("calls the registration back with the role and an extension context", async () => {
		const runner = await createRunner(roleExtension('["weak", "strong"]', "first"));

		runner.selectModelRole("strong");

		expect((globalThis as any).roleSelection).toEqual({
			role: "strong",
			mark: "first",
			hasSessionManager: true,
		});
	});

	it("reports a failing role callback as an extension error", async () => {
		const runner = await createRunner(
			`export default (pi) => {
				pi.registerModelRoles({
					roles: ["strong"],
					settingsKey: { field: "models", key: "role" },
					onSelect: () => { throw new Error("role handler broke"); },
				});
			};`,
		);
		const errors: string[] = [];
		runner.onError((error) => errors.push(`${error.event}: ${error.error}`));

		// The model selection stands: a role callback that throws is reported, not rethrown.
		expect(() => runner.selectModelRole("strong")).not.toThrow();
		expect(errors).toEqual(["select_model_role: role handler broke"]);
	});

	// spec "model-commands / /model は末尾の語を thinking レベルとロールとして解釈する": 語彙が未登録ならロールを切り出さない
	it("takes no role while no extension has registered a vocabulary", async () => {
		const runner = await createRunner(NO_ROLES);

		expect(runner.getModelRoles()).toBeUndefined();
		expect(() => runner.selectModelRole("strong")).not.toThrow();
		expect((globalThis as any).roleSelection).toBeUndefined();
		expect(parseModelCommandArgs("anthropic/claude-sonnet-4-5 strong", runner.getModelRoles()?.roles ?? [])).toEqual({
			searchTerm: "anthropic/claude-sonnet-4-5 strong",
		});
	});
});
