/**
 * Pins the upstream behavior the `models.strong` setting relies on: pi keeps settings keys it does
 * not know when it saves a known setting, so spirits reads its own key through `getSettings()`
 * without a core change (design Decision 1 of add-dual-model-routing).
 *
 * If this test fails, the assumption is gone and the setting moves to pi's `Settings` type.
 */

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

const SPIRITS_SETTINGS = { models: { strong: "anthropic/claude-opus-4-7" } };
const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_MODEL = "claude-sonnet-4-5";

test("keeps unknown settings keys after saving a known setting", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "spirits-settings-cwd-"));
	const agentDir = await mkdtemp(join(tmpdir(), "spirits-settings-agent-"));
	const settingsPath = join(agentDir, "settings.json");

	try {
		await writeFile(settingsPath, JSON.stringify(SPIRITS_SETTINGS, null, 2));
		const settings = SettingsManager.create(cwd, agentDir);
		expect(settings.getSettings().models).toEqual(SPIRITS_SETTINGS.models);

		settings.setDefaultModelAndProvider(DEFAULT_PROVIDER, DEFAULT_MODEL);
		await settings.flush();

		const saved = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
		expect(saved.models).toEqual(SPIRITS_SETTINGS.models);
		expect(saved.defaultProvider).toBe(DEFAULT_PROVIDER);
		expect(saved.defaultModel).toBe(DEFAULT_MODEL);
	} finally {
		await rm(cwd, { recursive: true, force: true });
		await rm(agentDir, { recursive: true, force: true });
	}
});
