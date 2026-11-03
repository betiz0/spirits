/**
 * Local fake provider used for one end-to-end transport check.
 *
 * It never reads real credentials and never calls an external inference API. A success here is
 * labelled as fake-provider success and is not reported as real-provider compatibility.
 */

import type { CompatibilitySuccessLabel } from "./labels.ts";
import { fakeProviderSuccess } from "./labels.ts";

/** One tool call returned by the fake model. */
export interface FakeToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

/** Result of the fake round trip. */
export interface FakeProviderResult {
	label: CompatibilitySuccessLabel;
	toolCalls: FakeToolCall[];
	rawResponse: unknown;
}

/** Options for the local fake endpoint. */
export interface FakeProviderOptions {
	/** Return a final text answer after the tool result instead of repeating the tool call. */
	finalAnswerAfterToolResult?: string;
}

/** Start a local OpenAI-compatible endpoint that returns the given tool call. */
export function startFakeProvider(
	toolCall: FakeToolCall,
	options: FakeProviderOptions = {},
): {
	baseUrl: string;
	requests: Array<{ url: string; authorization?: string; body?: unknown }>;
	stop(): void;
} {
	const requests: Array<{ url: string; authorization?: string; body?: unknown }> = [];
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const authorization = request.headers.get("authorization") ?? undefined;
			let body: unknown;
			try {
				body = await request.clone().json();
			} catch {
				body = undefined;
			}
			requests.push({ url: request.url, authorization, body });
			const messages = (body as { messages?: Array<{ role?: string }> } | undefined)?.messages;
			if (options.finalAnswerAfterToolResult && messages?.some((message) => message.role === "tool")) {
				return Response.json({
					id: "fake-completion-final",
					object: "chat.completion",
					created: 0,
					model: "fake-model",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: options.finalAnswerAfterToolResult },
							finish_reason: "stop",
						},
					],
					usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
				});
			}
			return Response.json({
				id: "fake-completion",
				object: "chat.completion",
				created: 0,
				model: "fake-model",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "fake-call-1",
									type: "function",
									function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			});
		},
	});
	return {
		baseUrl: `http://127.0.0.1:${server.port}`,
		requests,
		stop: () => server.stop(true),
	};
}

/** Ask the fake endpoint for one tool call; no real key is used. */
export async function requestFakeToolCall(baseUrl: string, toolName: string): Promise<FakeProviderResult> {
	const response = await fetch(`${baseUrl}/v1/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: "Bearer fake" },
		body: JSON.stringify({
			model: "fake-model",
			messages: [{ role: "user", content: "run one tsrepl cell" }],
			tools: [{ type: "function", function: { name: toolName, parameters: { type: "object" } } }],
		}),
	});
	const raw = await response.json();
	const choices = (raw as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> })
		.choices;
	const toolCalls: FakeToolCall[] = [];
	for (const call of choices?.[0]?.message?.tool_calls ?? []) {
		const name = call.function?.name;
		if (!name) continue;
		let args: Record<string, unknown> = {};
		try {
			args = JSON.parse(call.function?.arguments ?? "{}") as Record<string, unknown>;
		} catch {
			args = {};
		}
		toolCalls.push({ name, arguments: args });
	}
	return { label: fakeProviderSuccess(), toolCalls, rawResponse: raw };
}
