/**
 * The fixture agent directory.
 *
 * It mirrors the shape of a real `~/.spirits/agent`: Pi's own keys plus the keys spirits carries
 * along, credentials for the fake provider, and a provider definition that only exists on disk. The
 * same seed starts every phase, so the only difference between the fork-created and the
 * managed-created tree is which host ran the tool calls.
 *
 * `models.json` deliberately has no `apiKey`: the fake provider only works when the host also reads
 * `auth.json`, which is what makes the auth items a measurement instead of a tautology.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Provider id defined only by the seeded `models.json`. */
export const FILE_PROVIDER = "compat-fake";
/** Model the phases run on. */
export const FILE_MODEL = "fake-model";
/** Model `models.strong` points at, used by the routing phase. */
export const STRONG_MODEL = "fake-strong";
/** Provider with a stored credential and no model definition. */
export const STORED_ONLY_PROVIDER = "compat-stored-only";
/** Provider with neither credential nor definition. */
export const ABSENT_PROVIDER = "compat-absent";

/** Settings keys the investigation follows across hosts. */
export const TRACKED_SETTINGS_KEYS = [
	"defaultProvider",
	"defaultModel",
	"defaultThinkingLevel",
	"enabledModels",
	"models",
	"adcSpiritsKey",
];

/** The seeded settings object. */
export function seedSettings(marker: string): Record<string, unknown> {
	return {
		lastChangelogVersion: "0.0.0",
		defaultProvider: FILE_PROVIDER,
		defaultModel: FILE_MODEL,
		defaultThinkingLevel: "low",
		enabledModels: [`${FILE_PROVIDER}/*`],
		models: { strong: `${FILE_PROVIDER}/${STRONG_MODEL}`, role: "normal" },
		adcSpiritsKey: { origin: "seed", marker },
	};
}

/** The seeded auth object: a usable credential and one credential with no matching provider. */
export function seedAuth(): Record<string, unknown> {
	return {
		[FILE_PROVIDER]: { type: "api_key", key: "fake" },
		[STORED_ONLY_PROVIDER]: { type: "api_key", key: "fake" },
	};
}

/** The seeded provider registry, with no credential in it. */
export function seedModels(fakeUrl: string): Record<string, unknown> {
	const model = (id: string, name: string) => ({
		id,
		name,
		reasoning: true,
		input: ["text"],
		contextWindow: 128000,
		maxTokens: 4096,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	});
	return {
		providers: {
			[FILE_PROVIDER]: {
				name: "ADC fake provider",
				baseUrl: `${fakeUrl}/v1`,
				api: "openai-completions",
				models: [model(FILE_MODEL, "ADC fake model"), model(STRONG_MODEL, "ADC fake strong model")],
			},
		},
	};
}

/** The marker texts the probe looks for in the rendered system prompt. */
export function seedMarkers(marker: string): string[] {
	return [`adc memory line ${marker}`, `adc code-mode override ${marker}`, `adc goal ${marker}`];
}

/** Write the seed files into an agent directory and return what was written. */
export async function writeSeedAgentDir(
	dir: string,
	options: { fakeUrl: string; marker: string },
): Promise<{ settings: Record<string, unknown>; auth: Record<string, unknown>; models: Record<string, unknown> }> {
	await mkdir(dir, { recursive: true });
	const settings = seedSettings(options.marker);
	const auth = seedAuth();
	const models = seedModels(options.fakeUrl);
	// Tabs, not Pi's two spaces: a writer that reformats the file then shows up in the diff.
	await writeFile(join(dir, "settings.json"), `${JSON.stringify(settings, null, "\t")}\n`, "utf-8");
	await writeFile(join(dir, "auth.json"), `${JSON.stringify(auth, null, "\t")}\n`, "utf-8");
	await writeFile(join(dir, "models.json"), `${JSON.stringify(models, null, "\t")}\n`, "utf-8");
	return { settings, auth, models };
}
