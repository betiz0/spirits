import { expect, test } from "bun:test";
import {
	parseSseChunks,
	requestFakeToolCall,
	startFakeProvider,
} from "../../../scripts/managed-pi-compat/fake-provider.ts";
import { executeCapturedTsrepl, createProbeTsreplTool } from "../../../scripts/managed-pi-compat/tsrepl.ts";

async function streamChatCompletions(
	baseUrl: string,
	messages: Array<Record<string, unknown>>,
): Promise<string> {
	const response = await fetch(`${baseUrl}/v1/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: "Bearer fake" },
		body: JSON.stringify({ model: "fake-model", messages, stream: true }),
	});
	return response.text();
}

test("model tool call reaches tsrepl", async () => {
	const provider = startFakeProvider({ name: "tsrepl", arguments: { code: "return 1 + 1" } });
	try {
		const result = await requestFakeToolCall(provider.baseUrl, "tsrepl");
		expect(result.toolCalls[0]?.name).toBe("tsrepl");
		const cell = await executeCapturedTsrepl(
			createProbeTsreplTool(),
			String(result.toolCalls[0]?.arguments.code),
			process.cwd(),
		);
		expect(cell.text).toContain("2");
	} finally {
		provider.stop();
	}
});

test("fake provider streams chat.completion.chunk events", async () => {
	const provider = startFakeProvider(
		{ name: "tsrepl", arguments: { code: "return 1 + 1" } },
		{ toolCallChunks: 2 },
	);
	try {
		const text = await streamChatCompletions(provider.baseUrl, [{ role: "user", content: "run" }]);
		expect(text).toContain("chat.completion.chunk");
		expect(text).toContain("tool_calls");
		expect(text).toContain('"name":"tsrepl"');
		expect(text).toContain('"finish_reason":"tool_calls"');
		expect(text).toContain("data: [DONE]");
		const parsed = parseSseChunks(text);
		expect(parsed.toolCalls).toEqual([{ name: "tsrepl", arguments: { code: "return 1 + 1" } }]);
		expect(parsed.finishReasons).toEqual(["tool_calls"]);
	} finally {
		provider.stop();
	}
});

test("fake provider streams a final answer after the tool result", async () => {
	const provider = startFakeProvider(
		{ name: "tsrepl", arguments: { code: "return 1 + 1" } },
		{ finalAnswerAfterToolResult: "finished" },
	);
	try {
		const text = await streamChatCompletions(provider.baseUrl, [
			{ role: "user", content: "run" },
			{ role: "assistant", content: "", tool_calls: [] },
			{ role: "tool", content: "2" },
		]);
		expect(text).toContain('"content":"finished"');
		expect(text).toContain('"finish_reason":"stop"');
		const parsed = parseSseChunks(text);
		expect(parsed.finalAnswer).toBe("finished");
		expect(parsed.finishReasons).toContain("stop");
	} finally {
		provider.stop();
	}
});

test("reply hook answers a parent with a tool call and a child with text", async () => {
	const provider = startFakeProvider(
		{ name: "tsrepl", arguments: { code: "parent cell" } },
		{
			reply: (body) =>
				JSON.stringify(body ?? "").includes("parent prompt")
					? { kind: "tool-call" }
					: { kind: "text", text: "child answer" },
		},
	);
	try {
		const parent = await streamChatCompletions(provider.baseUrl, [{ role: "user", content: "parent prompt" }]);
		expect(parseSseChunks(parent).toolCalls).toEqual([{ name: "tsrepl", arguments: { code: "parent cell" } }]);
		const child = await streamChatCompletions(provider.baseUrl, [{ role: "user", content: "child task" }]);
		const parsedChild = parseSseChunks(child);
		expect(parsedChild.finalAnswer).toBe("child answer");
		expect(parsedChild.toolCalls).toEqual([]);
	} finally {
		provider.stop();
	}
});

test("no real credentials are read", async () => {
	const provider = startFakeProvider({ name: "tsrepl", arguments: { code: "return 2" } });
	try {
		await requestFakeToolCall(provider.baseUrl, "tsrepl");
		expect(provider.requests).toHaveLength(1);
		expect(provider.requests[0]?.authorization).toBe("Bearer fake");
	} finally {
		provider.stop();
	}
});

test("fake provider success is not reported as real provider compatibility", async () => {
	const provider = startFakeProvider({ name: "tsrepl", arguments: { code: "return 1" } });
	try {
		const result = await requestFakeToolCall(provider.baseUrl, "tsrepl");
		expect(result.label).toEqual({ scope: "fake-provider", realProviderCompatibility: false });
	} finally {
		provider.stop();
	}
});

test("the endpoint records the connection state of each request", async () => {
	const provider = startFakeProvider(
		{ name: "tsrepl", arguments: { code: "return 1" } },
		{ reply: () => ({ kind: "text", text: "child answer", delayMs: 4000 }) },
	);
	try {
		const controller = new AbortController();
		const pending = fetch(`${provider.baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: "Bearer fake" },
			body: JSON.stringify({ model: "fake-model", messages: [{ role: "user", content: "child task" }], stream: true }),
			signal: controller.signal,
		});
		await new Promise((resolve) => setTimeout(resolve, 120));
		// The parent abort cuts the child's request; the endpoint must see the client hang up while
		// the reply is still being held, because that close is the child-stop observation.
		controller.abort();
		await pending.catch(() => undefined);
		const held = provider.requests[0];
		expect(held?.kind).toBe("text");
		expect(held?.delayMs).toBe(4000);
		expect(held?.closedAt).toBeTypeOf("number");
		expect(held?.respondedAt).toBeUndefined();
		expect(provider.closedEarly().map((request) => request.url)).toEqual([held?.url]);
		expect(provider.open()).toEqual([]);
	} finally {
		provider.stop();
	}
});

test("a delivered reply is recorded as answered, not cut", async () => {
	const provider = startFakeProvider({ name: "tsrepl", arguments: { code: "return 1" } });
	try {
		await requestFakeToolCall(provider.baseUrl, "tsrepl");
		const record = provider.requests.at(-1);
		expect(record?.respondedAt).toBeTypeOf("number");
		expect(provider.closedEarly()).toEqual([]);
	} finally {
		provider.stop();
	}
});
