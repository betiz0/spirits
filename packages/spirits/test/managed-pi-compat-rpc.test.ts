import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAbortRpcProbe, runStagedRpcProbe } from "../../../scripts/managed-pi-compat/rpc.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "compat-rpc-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A host that answers requests, and stays silent for extension commands like Pi does. */
const SILENT_HOST = `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const trace = process.env.SILENT_HOST_TRACE;
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	for (;;) {
		const newline = buffer.indexOf("\\n");
		if (newline === -1) break;
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (!line) continue;
		const request = JSON.parse(line);
		if (request.message === "/silent") {
			appendFileSync(trace, "silent\\n");
			continue;
		}
		appendFileSync(trace, (request.message ?? request.type) + "\\n");
		process.stdout.write(JSON.stringify({ type: "response", id: request.id, success: true }) + "\\n");
	}
});
`;

describe("staged RPC probe", () => {
	// A stage that waits for an event which never arrives must not end the probe: the stages after
	// it drive the observation (record state, run the command, record state again).
	it("keeps running stages after a stage that times out", async () => {
		const dir = await tempDir();
		const hostPath = join(dir, "host.ts");
		const tracePath = join(dir, "trace.txt");
		await writeFile(hostPath, SILENT_HOST);
		const result = await runStagedRpcProbe({
			command: [process.execPath, hostPath],
			cwd: dir,
			env: { SILENT_HOST_TRACE: tracePath },
			stages: [
				{ requests: [{ id: "first", type: "get_state" }] },
				{ requests: [{ id: "silent", type: "prompt", message: "/silent" }], waitFor: () => false, timeoutMs: 300 },
				{ requests: [{ id: "last", type: "prompt", message: "/after" }] },
			],
			timeoutMs: 5_000,
		});
		const trace = await readFile(tracePath, "utf8");
		expect(trace.trim().split("\n")).toEqual(["get_state", "silent", "/after"]);
		expect(result.records.filter((record) => record.type === "response").map((record) => record.id)).toEqual([
			"first",
			"last",
		]);
	});
});

/** A host that answers every request and keeps the session open until stdin closes. */
const ECHO_HOST = `#!/usr/bin/env bun
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	for (;;) {
		const newline = buffer.indexOf("\\n");
		if (newline === -1) break;
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (!line) continue;
		const request = JSON.parse(line);
		process.stdout.write(
			JSON.stringify({ type: "response", id: request.id, command: request.type, success: true, data: { entries: [] } }) + "\\n",
		);
	}
});
`;

describe("abort probe polling", () => {
	// A tool call that was cut short keeps running and can write its entry after the run settled, so
	// one read at agent_settled cannot tell "nothing was written" from "the read came too early".
	it("re-reads after the abort and takes a final read once the outside signal says stopped", async () => {
		const dir = await tempDir();
		const hostPath = join(dir, "host.ts");
		await writeFile(hostPath, ECHO_HOST);
		const startedAt = Date.now();
		let stoppedSeen = false;
		const result = await runAbortRpcProbe({
			command: [process.execPath, hostPath],
			cwd: dir,
			env: {},
			requests: [{ id: "prompt-1", type: "prompt" }],
			abortRequest: { id: "abort-1", type: "abort" },
			abortAfterMs: 20,
			timeoutMs: 5_000,
			poll: {
				request: { id: "entries", type: "get_entries" },
				intervalMs: 20,
				timeoutMs: 2_000,
				until: () => {
					if (Date.now() - startedAt < 120) return false;
					stoppedSeen = true;
					return true;
				},
			},
		});
		const readIds = result.records
			.filter((record) => record.type === "response" && record.command === "get_entries")
			.map((record) => String(record.id));
		expect(readIds.length).toBeGreaterThanOrEqual(3);
		expect(readIds.at(-1)).toBe("entries-final");
		expect(stoppedSeen).toBe(true);
		// The final read happens after the stop was observed, which is where a late entry can still show up.
		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(120);
		expect(result.abortSent).toBe(true);
	});

	it("stops polling at the poll timeout when the outside signal never fires", async () => {
		const dir = await tempDir();
		const hostPath = join(dir, "host.ts");
		await writeFile(hostPath, ECHO_HOST);
		const startedAt = Date.now();
		const result = await runAbortRpcProbe({
			command: [process.execPath, hostPath],
			cwd: dir,
			env: {},
			requests: [{ id: "prompt-1", type: "prompt" }],
			abortRequest: { id: "abort-1", type: "abort" },
			abortAfterMs: 20,
			timeoutMs: 5_000,
			poll: { request: { id: "entries", type: "get_entries" }, intervalMs: 20, timeoutMs: 120, until: () => false },
		});
		const readIds = result.records
			.filter((record) => record.type === "response" && record.command === "get_entries")
			.map((record) => String(record.id));
		expect(readIds.at(-1)).toBe("entries-final");
		expect(Date.now() - startedAt).toBeLessThan(2_000);
	});

	it("does not poll when no poll was asked for", async () => {
		const dir = await tempDir();
		const hostPath = join(dir, "host.ts");
		await writeFile(hostPath, ECHO_HOST);
		const result = await runAbortRpcProbe({
			command: [process.execPath, hostPath],
			cwd: dir,
			env: {},
			requests: [{ id: "prompt-1", type: "prompt" }],
			abortRequest: { id: "abort-1", type: "abort" },
			abortAfterMs: 20,
			timeoutMs: 5_000,
		});
		expect(result.records.some((record) => record.command === "get_entries")).toBe(false);
		expect(result.abortSent).toBe(true);
	});
});
