/**
 * Local fake-provider registration for the managed Pi compatibility runner.
 *
 * The endpoint is a local OpenAI-compatible server. The fixture never reads real credentials.
 * Two models are registered so a strong-phase route is distinguishable from the normal one.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Model the normal route serves. */
const FAKE_MODEL_ID = "fake-model";
/** Model `models.strong` points at, so a strong-phase request is visible in the request body. */
const FAKE_STRONG_MODEL_ID = "fake-strong";

function model(id: string, name: string) {
	return {
		id,
		name,
		reasoning: true,
		input: ["text"],
		contextWindow: 128000,
		maxTokens: 4096,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

export default function customProvider(pi: ExtensionAPI): void {
	const baseUrl = process.env.MANAGED_PI_COMPAT_FAKE_PROVIDER_URL;
	if (!baseUrl) return;
	pi.registerProvider("compat-fake", {
		name: "Compatibility fake provider",
		baseUrl: `${baseUrl}/v1`,
		apiKey: "fake",
		api: "openai-completions",
		models: [model(FAKE_MODEL_ID, "Fake model"), model(FAKE_STRONG_MODEL_ID, "Fake strong model")],
	});
}
