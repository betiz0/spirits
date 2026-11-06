import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStagedRpcProbe } from "../../../scripts/managed-pi-compat/rpc.ts";

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
