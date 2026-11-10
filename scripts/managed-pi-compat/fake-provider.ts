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

/** The context size a reply reports, which is what pi measures an automatic compaction against. */
export interface FakeUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

/** Usage a plain text reply reports unless the fixture asks for another size. */
const DEFAULT_USAGE: FakeUsage = { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 };

/** One reply the fake endpoint can produce for a request. */
export type FakeReply =
	| { kind: "tool-call"; toolCall?: FakeToolCall; delayMs?: number }
	| { kind: "text"; text: string; delayMs?: number };

/**
 * One request as the endpoint saw it, with the connection outcome.
 *
 * Timestamps are milliseconds after the endpoint started. A request the client hung up on
 * (`closedAt` set, `respondedAt` absent) is the evidence that the session which sent it stopped
 * mid-request: an rlm child that keeps running keeps its request open until the reply lands.
 */
export interface FakeProviderRequest {
	url: string;
	authorization?: string;
	body?: unknown;
	/**
	 * The model the request asked for, read off the request body.
	 *
	 * This is what tells a routed child from an unrouted one: a child of an `spirits/auto` parent that
	 * reached this endpoint naming the virtual model was never resolved to a physical model.
	 */
	model?: string;
	/** The reply class the endpoint chose for this request. */
	kind?: "tool-call" | "text";
	/** Milliseconds after the endpoint started. */
	receivedAt: number;
	/** Set once the endpoint finished producing the reply. */
	respondedAt?: number;
	/** Set when the client closed the connection, whether or not the reply was produced. */
	closedAt?: number;
	/** Requested reply delay in milliseconds, so a hung-up request is told from a fast one. */
	delayMs?: number;
}

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
	/**
	 * Report the context size for a plain text reply.
	 *
	 * Pi decides an automatic compaction from the usage a reply carries, so a fixture that wants the
	 * compaction to land at a chosen point grows the reported usage there. Tool-call replies keep the
	 * small usage the rlm items depend on.
	 */
	usage?: (body: unknown) => FakeUsage;
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

function sseResponse(events: string[], onWritten: () => void): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			for (const event of events) controller.enqueue(encoder.encode(event));
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
			onWritten();
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

function finalAnswerEvents(answer: string, usage: FakeUsage): string[] {
	return [
		chunk("fake-final-1", { role: "assistant", content: "" }, null),
		chunk("fake-final-2", { content: answer }, null),
		chunk("fake-final-3", {}, "stop", usage),
	];
}

/** Non-streaming body of a plain text completion. */
function completionJson(answer: string, finishReason: string, usage: FakeUsage): unknown {
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
		usage,
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
	requests: FakeProviderRequest[];
	/** Requests whose reply was never produced because the client hung up. */
	closedEarly(): FakeProviderRequest[];
	/** Requests still waiting for a reply with the connection open. */
	open(): FakeProviderRequest[];
	stop(): void;
} {
	const startedAt = Date.now();
	const elapsed = (): number => Date.now() - startedAt;
	const requests: FakeProviderRequest[] = [];
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
			const requested = (body as { model?: unknown } | undefined)?.model;
			const record: FakeProviderRequest = {
				url: request.url,
				authorization,
				body,
				model: typeof requested === "string" ? requested : undefined,
				receivedAt: elapsed(),
			};
			requests.push(record);
			request.signal.addEventListener("abort", () => {
				record.closedAt ??= elapsed();
			});
			const messages = (body as { messages?: ChatMessage[] } | undefined)?.messages;
			const wantsFinalAnswer =
				options.finalAnswerAfterToolResult !== undefined &&
				(messages ?? []).some((message) => message.role === "tool");
			const stream = (body as { stream?: boolean } | undefined)?.stream === true;
			const written = (): void => {
				record.respondedAt ??= elapsed();
			};
			const path = new URL(request.url).pathname;
			if (path.endsWith("/models")) {
				written();
				return Response.json({
					object: "list",
					data: [{ id: toolCall.name, object: "model", created: 0, owned_by: "compat-fake" }],
				});
			}
			const reply = options.reply?.(body);
			const usage = options.usage?.(body) ?? DEFAULT_USAGE;
			const delayMs = reply?.delayMs ?? options.delayMs;
			record.kind = reply ? reply.kind : "tool-call";
			record.delayMs = delayMs;
			if (delayMs && delayMs > 0 && !request.signal.aborted) {
				// Stop waiting when the client hangs up, so the recorded close time is the client's.
				let timer: ReturnType<typeof setTimeout> | undefined;
				await new Promise<void>((resolve) => {
					const finish = (): void => {
						if (timer !== undefined) clearTimeout(timer);
						request.signal.removeEventListener("abort", finish);
						resolve();
					};
					timer = setTimeout(finish, delayMs);
					request.signal.addEventListener("abort", finish, { once: true });
				});
			}
			// A client that hung up during the delay must not receive a reply: writing one would hide
			// the disconnect the rlm child abort item measures.
			if (request.signal.aborted) return new Response(null, { status: 499 });
			if (reply) {
				const answer = reply.kind === "text" ? reply.text : undefined;
				const call = reply.kind === "tool-call" ? (reply.toolCall ?? toolCall) : undefined;
				if (stream) {
					return sseResponse(
						answer !== undefined
							? finalAnswerEvents(answer, usage)
							: toolCallEvents(call as FakeToolCall, options.toolCallChunks ?? 1),
						written,
					);
				}
				written();
				if (answer !== undefined) {
					return Response.json(completionJson(answer, "stop", usage));
				}
				return Response.json(toolCallJson(call as FakeToolCall));
			}
			if (stream) {
				return sseResponse(
					wantsFinalAnswer
						? finalAnswerEvents(options.finalAnswerAfterToolResult as string, usage)
						: toolCallEvents(toolCall, options.toolCallChunks ?? 1),
					written,
				);
			}
			written();
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
		closedEarly: () => requests.filter((record) => record.closedAt !== undefined && record.respondedAt === undefined),
		open: () => requests.filter((record) => record.closedAt === undefined && record.respondedAt === undefined),
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
