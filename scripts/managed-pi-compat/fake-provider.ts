/**
 * Local fake provider used for one end-to-end transport check.
 *
 * It never reads real credentials and never calls an external inference API. A success here is
 * labelled as fake-provider success and is not reported as real-provider compatibility.
 *
 * The endpoint reproduces the SSE streaming shape Pi's `openai-completions` provider consumes:
 * `chat.completion.chunk` events with `delta.tool_calls`, a `finish_reason: "tool_calls"` chunk
 * with usage, and `data: [DONE]`. A non-streaming JSON body is kept for direct probes only.
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

/** One reply the fake endpoint can produce for a request. */
export type FakeReply =
	| { kind: "tool-call"; toolCall?: FakeToolCall; delayMs?: number }
	| { kind: "text"; text: string; delayMs?: number };

/** Options for the local fake endpoint. */
export interface FakeProviderOptions {
	/** Return a final text answer after the tool result instead of repeating the tool call. */
	finalAnswerAfterToolResult?: string;
	/** Delay the first streamed chunk; used to observe a child abort. */
	delayMs?: number;
	/** Split the tool-call arguments across this many chunks. */
	toolCallChunks?: number;
	/**
	 * Decide the reply per request. Without it every request without a tool result repeats the
	 * configured tool call, which makes a nested child session recurse. A parent/child fixture
	 * answers the parent with a tool call and the child with plain text.
	 */
	reply?: (body: unknown) => FakeReply;
}

interface ChatMessage {
	role?: string;
}

function chunk(id: string, delta: Record<string, unknown>, finish_reason: string | null, usage?: unknown): string {
	const data = {
		id,
		object: "chat.completion.chunk",
		created: 0,
		model: "fake-model",
		...(usage ? { usage } : {}),
		choices: [{ index: 0, delta, finish_reason }],
	};
	return `data: ${JSON.stringify(data)}\n\n`;
}

function sseResponse(events: string[]): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			for (const event of events) controller.enqueue(encoder.encode(event));
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
	return new Response(body, {
		headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
	});
}

function toolCallEvents(toolCall: FakeToolCall, chunks: number): string[] {
	const serialized = JSON.stringify(toolCall.arguments);
	const size = Math.max(1, Math.ceil(serialized.length / Math.max(1, chunks)));
	const parts: string[] = [];
	for (let index = 0; index < serialized.length; index += size) {
		parts.push(serialized.slice(index, index + size));
	}
	const events: string[] = [
		chunk("fake-chunk-1", { role: "assistant", content: null }, null),
	];
	parts.forEach((part, index) => {
		const delta: Record<string, unknown> = {
			tool_calls: [
				{
					index: 0,
					...(index === 0 ? { id: "fake-call-1", type: "function" } : {}),
					function: { ...(index === 0 ? { name: toolCall.name } : {}), arguments: part },
				},
			],
		};
		events.push(chunk(`fake-chunk-${index + 2}`, delta, null));
	});
	events.push(
		chunk("fake-finish", {}, "tool_calls", {
			prompt_tokens: 1,
			completion_tokens: 1,
			total_tokens: 2,
		}),
	);
	return events;
}

function finalAnswerEvents(answer: string): string[] {
	return [
		chunk("fake-final-1", { role: "assistant", content: "" }, null),
		chunk("fake-final-2", { content: answer }, null),
		chunk(
			"fake-final-3",
			{},
			"stop",
			{ prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
		),
	];
}

/** Non-streaming body of a plain text completion. */
function completionJson(answer: string, finishReason: string): unknown {
	return {
		id: "fake-completion-final",
		object: "chat.completion",
		created: 0,
		model: "fake-model",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: answer },
				finish_reason: finishReason,
			},
		],
		usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
	};
}

/** Non-streaming body of a tool-call completion. */
function toolCallJson(call: FakeToolCall): unknown {
	return {
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
							function: { name: call.name, arguments: JSON.stringify(call.arguments) },
						},
					],
				},
				finish_reason: "tool_calls",
			},
		],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	};
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
			const messages = (body as { messages?: ChatMessage[] } | undefined)?.messages;
			const wantsFinalAnswer =
				options.finalAnswerAfterToolResult !== undefined &&
				(messages ?? []).some((message) => message.role === "tool");
			const stream = (body as { stream?: boolean } | undefined)?.stream === true;
			const path = new URL(request.url).pathname;
			if (path.endsWith("/models")) {
				return Response.json({
					object: "list",
					data: [{ id: toolCall.name, object: "model", created: 0, owned_by: "compat-fake" }],
				});
			}
			const reply = options.reply?.(body);
			const delayMs = reply?.delayMs ?? options.delayMs;
			if (delayMs && delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}
			if (reply) {
				const answer = reply.kind === "text" ? reply.text : undefined;
				const call = reply.kind === "tool-call" ? (reply.toolCall ?? toolCall) : undefined;
				if (stream) {
					return sseResponse(
						answer !== undefined ? finalAnswerEvents(answer) : toolCallEvents(call as FakeToolCall, options.toolCallChunks ?? 1),
					);
				}
				if (answer !== undefined) {
					return Response.json(completionJson(answer, "stop"));
				}
				return Response.json(toolCallJson(call as FakeToolCall));
			}
			if (stream) {
				return sseResponse(
					wantsFinalAnswer
						? finalAnswerEvents(options.finalAnswerAfterToolResult as string)
						: toolCallEvents(toolCall, options.toolCallChunks ?? 1),
				);
			}
			if (wantsFinalAnswer) {
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

interface SseChunk {
	choices?: Array<{
		delta?: {
			content?: string | null;
			tool_calls?: Array<{
				index?: number;
				id?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason?: string | null;
	}>;
}

interface ToolCallAccumulator {
	name: string;
	arguments: string;
}

/** Parse SSE `chat.completion.chunk` events into tool calls and a final answer. */
export function parseSseChunks(text: string): {
	toolCalls: FakeToolCall[];
	finalAnswer?: string;
	finishReasons: string[];
} {
	const accumulators = new Map<number, ToolCallAccumulator>();
	const finishReasons: string[] = [];
	let finalAnswer = "";
	for (const line of text.split("\n")) {
		if (!line.startsWith("data:")) continue;
		const payload = line.slice("data:".length).trim();
		if (payload === "[DONE]") continue;
		let parsed: SseChunk;
		try {
			parsed = JSON.parse(payload) as SseChunk;
		} catch {
			continue;
		}
		const choice = parsed.choices?.[0];
		if (!choice) continue;
		if (choice.finish_reason) finishReasons.push(choice.finish_reason);
		const content = choice.delta?.content;
		if (typeof content === "string" && content.length > 0) finalAnswer += content;
		for (const call of choice.delta?.tool_calls ?? []) {
			const index = call.index ?? 0;
			const current = accumulators.get(index) ?? { name: "", arguments: "" };
			if (call.function?.name) current.name = call.function.name;
			current.arguments += call.function?.arguments ?? "";
			accumulators.set(index, current);
		}
	}
	const toolCalls: FakeToolCall[] = [];
	for (const accumulator of accumulators.values()) {
		if (accumulator.name.length === 0) continue;
		let args: Record<string, unknown> = {};
		try {
			args = JSON.parse(accumulator.arguments || "{}") as Record<string, unknown>;
		} catch {
			args = {};
		}
		toolCalls.push({ name: accumulator.name, arguments: args });
	}
	return {
		toolCalls,
		finalAnswer: finalAnswer.length > 0 ? finalAnswer : undefined,
		finishReasons,
	};
}

/** Ask the fake endpoint for one tool call over the streaming transport; no real key is used. */
export async function requestFakeToolCall(baseUrl: string, toolName: string): Promise<FakeProviderResult> {
	const response = await fetch(`${baseUrl}/v1/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: "Bearer fake" },
		body: JSON.stringify({
			model: "fake-model",
			messages: [{ role: "user", content: "run one tsrepl cell" }],
			tools: [{ type: "function", function: { name: toolName, parameters: { type: "object" } } }],
			stream: true,
		}),
	});
	const text = await response.text();
	const parsed = parseSseChunks(text);
	return { label: fakeProviderSuccess(), toolCalls: parsed.toolCalls, rawResponse: text };
}
