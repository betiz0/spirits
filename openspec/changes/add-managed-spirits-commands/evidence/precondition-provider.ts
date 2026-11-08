/** Fake provider registration for the precondition experiment; small context window is configurable. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function model(id: string, name: string, contextWindow: number) {
	return {
		id,
		name,
		reasoning: true,
		input: ["text"],
		contextWindow,
		maxTokens: 1024,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

export default function experimentProvider(pi: ExtensionAPI): void {
	const baseUrl = process.env.MANAGED_PI_COMPAT_FAKE_PROVIDER_URL;
	if (!baseUrl) return;
	const contextWindow = Number(process.env.EXP_CONTEXT_WINDOW ?? "128000");
	pi.registerProvider("compat-fake", {
		name: "Experiment fake provider",
		baseUrl: `${baseUrl}/v1`,
		apiKey: "fake",
		api: "openai-completions",
		models: [model("fake-model", "Fake model", contextWindow), model("fake-strong", "Fake strong model", contextWindow)],
	});
}
