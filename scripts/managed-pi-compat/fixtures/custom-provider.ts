/**
 * Local fake-provider registration for the managed Pi compatibility runner.
 *
 * The endpoint is a local OpenAI-compatible server. The fixture never reads real credentials.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function customProvider(pi: ExtensionAPI): void {
	const baseUrl = process.env.MANAGED_PI_COMPAT_FAKE_PROVIDER_URL;
	if (!baseUrl) return;
	pi.registerProvider("compat-fake", {
		name: "Compatibility fake provider",
		baseUrl: `${baseUrl}/v1`,
		apiKey: "fake",
		api: "openai-completions",
		models: [
			{
				id: "fake-model",
				name: "Fake model",
				reasoning: false,
				input: ["text"],
				contextWindow: 128000,
				maxTokens: 4096,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			},
		],
	});
}
