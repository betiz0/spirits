/**
 * How the runner measures a thinking level.
 *
 * The level used to be judged by calling `pi.setThinkingLevel()` and reading it back, which measured the
 * extension API rather than the request. A role setting is only real once the level appears on the wire,
 * so the two halves observed here are the RPC that moves the session's level and the body the fake
 * provider actually received.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	reasoningEffortFor,
	startFakeProvider,
	type FakeProviderRequest,
} from "../../../scripts/managed-pi-compat/fake-provider.ts";
import { runStagedRpcProbe, thinkingLevelRequest } from "../../../scripts/managed-pi-compat/rpc.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "compat-thinking-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Send one chat completion the way pi sends it: the level is a field of the body. */
async function chat(
	baseUrl: string,
	body: Record<string, unknown>,
): Promise<void> {
	const response = await fetch(`${baseUrl}/v1/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: "Bearer fake" },
		body: JSON.stringify({ model: "fake-model", stream: true, ...body }),
	});
	await response.text();
}

test("the reasoning level of a request body is recorded", async () => {
	const provider = startFakeProvider({ name: "unused", arguments: {} });
	try {
		await chat(provider.baseUrl, { messages: [{ role: "user", content: "marked: high turn" }], reasoning_effort: "high" });
		await chat(provider.baseUrl, { messages: [{ role: "user", content: "marked: plain turn" }] });

		const requests: readonly FakeProviderRequest[] = provider.requests;
		expect(requests.map((request) => request.reasoningEffort)).toEqual(["high", undefined]);
		// The marker picks the turn, so a run with several levels still names the one a purpose asked about.
		expect(reasoningEffortFor(provider, "marked: high turn")).toBe("high");
		expect(reasoningEffortFor(provider, "marked: plain turn")).toBeUndefined();
		expect(reasoningEffortFor(provider, "marked: missing")).toBeUndefined();
	} finally {
		provider.stop();
	}
});

// The fixture's two models are declared `reasoning: true`, which is what lets a level reach the body at
// all. A model without it would carry nothing, and a purpose that read a level there would be reading a
// value the host never sent.
test("the level reaches the body only because the model reasons", async () => {
	const provider = startFakeProvider({ name: "unused", arguments: {} });
	try {
		await chat(provider.baseUrl, { messages: [{ role: "user", content: "reasoning off" }] });
		expect(provider.requests[0]?.body).toBeObject();
		expect((provider.requests[0]?.body as { reasoning_effort?: unknown }).reasoning_effort).toBeUndefined();
	} finally {
		provider.stop();
	}
});

test("the thinking level travels as pi's own set_thinking_level request", async () => {
	const dir = await tempDir();
	const tracePath = join(dir, "trace.txt");
	// A host that answers every request and writes the received line, so the frame the runner sent is
	// what the file shows.
	const hostPath = join(dir, "host.ts");
	await writeFile(
		hostPath,
		[
			'#!/usr/bin/env bun',
			'import { appendFileSync } from "node:fs";',
			'let buffer = "";',
			'process.stdin.setEncoding("utf8");',
			'process.stdin.on("data", (chunk) => {',
			'\tbuffer += chunk;',
			'\tfor (;;) {',
			'\t\tconst newline = buffer.indexOf("\\n");',
			'\t\tif (newline === -1) break;',
			'\t\tconst line = buffer.slice(0, newline).trim();',
			'\t\tbuffer = buffer.slice(newline + 1);',
			'\t\tif (!line) continue;',
			'\t\tconst request = JSON.parse(line);',
			'\t\tappendFileSync(process.env.THINKING_TRACE, JSON.stringify(request) + "\\n");',
			'\t\tprocess.stdout.write(JSON.stringify({ type: "response", id: request.id, success: true }) + "\\n");',
			'\t}',
			'});',
			'',
		].join("\n"),
	);

	const result = await runStagedRpcProbe({
		command: [process.execPath, hostPath],
		cwd: dir,
		env: { THINKING_TRACE: tracePath },
		stages: [{ requests: [thinkingLevelRequest("level-1", "xhigh")] }],
		timeoutMs: 10_000,
	});

	const sent = (await Bun.file(tracePath).text())
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as { id?: string; type?: string; level?: string });
	expect(sent).toEqual([{ id: "level-1", type: "set_thinking_level", level: "xhigh" }]);
	expect(result.records.some((record) => record.type === "response" && record.id === "level-1")).toBe(true);
});
