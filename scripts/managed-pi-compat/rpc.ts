/**
 * Minimal RPC and process probes used by the compatibility runner.
 *
 * These helpers intentionally do not import Pi: they start an absolute executable, frame JSONL,
 * correlate responses by id, and collect stderr separately from protocol records.
 */

/** One RPC request. */
export interface RpcRequest {
	id: string;
	type: string;
	[key: string]: unknown;
}

/** One RPC record. */
export interface RpcRecord {
	type?: string;
	id?: string;
	command?: string;
	success?: boolean;
	error?: string;
	data?: unknown;
	[key: string]: unknown;
}

/** Options for an RPC probe. */
export interface RpcProbeOptions {
	command: readonly string[];
	cwd: string;
	env: Record<string, string | undefined>;
	requests: readonly RpcRequest[];
	timeoutMs?: number;
	/** Keep reading after all responses until this predicate sees the wanted event(s). */
	waitFor?: (records: readonly RpcRecord[]) => boolean;
}

/** Result of an RPC probe. */
export interface RpcProbeResult {
	records: RpcRecord[];
	stderr: string;
	exitCode: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function stringEnv(env: Record<string, string | undefined>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) result[key] = value;
	}
	return result;
}

/** Start a process, send RPC requests, and collect records until all ids responded or timeout. */
export async function runRpcProbe(options: RpcProbeOptions): Promise<RpcProbeResult> {
	const child = Bun.spawn([...options.command], {
		cwd: options.cwd,
		env: stringEnv(options.env),
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const expected = new Set(options.requests.map((request) => request.id));
	const records: RpcRecord[] = [];
	let stderr = "";
	const stderrReader = child.stderr.getReader();
	const readStderr = (async () => {
		for (;;) {
			const { done, value } = await stderrReader.read();
			if (done) break;
			stderr += new TextDecoder().decode(value);
		}
	})();
	for (const request of options.requests) {
		child.stdin.write(`${JSON.stringify(request)}\n`);
	}
	child.stdin.flush();
	const reader = child.stdout.getReader();
	let buffer = "";
	const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	let resolved = false;
	while (!resolved && Date.now() < deadline) {
		const remaining = Math.max(1, deadline - Date.now());
		const read = await Promise.race([
			reader.read(),
			new Promise<{ done: true; value: undefined }>((resolve) =>
				setTimeout(() => resolve({ done: true, value: undefined }), remaining),
			),
		]);
		if (read.done) break;
		buffer += new TextDecoder().decode(read.value);
		for (;;) {
			const newline = buffer.indexOf("\n");
			if (newline === -1) break;
			const line = buffer.slice(0, newline).replace(/\r$/, "");
			buffer = buffer.slice(newline + 1);
			if (!line.trim()) continue;
			try {
				const record = JSON.parse(line) as RpcRecord;
				records.push(record);
				if (record.type === "response" && record.id) expected.delete(record.id);
			} catch {
				// Non-protocol stdout is a failure of the probe, but leave parsing to the caller.
				records.push({ type: "invalid-json", raw: line });
			}
		}
		if (expected.size === 0 && (options.waitFor?.(records) ?? true)) resolved = true;
	}
	child.stdin.end();
	const exitCode = await child.exited;
	await readStderr;
	await reader.cancel().catch(() => {});
	return { records, stderr, exitCode };
}

/** Result of running a process to completion. */
export interface CommandProbeResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/** Run a command with isolated env and capture output. */
export async function runCommandProbe(options: {
	command: readonly string[];
	cwd: string;
	env: Record<string, string | undefined>;
	timeoutMs?: number;
}): Promise<CommandProbeResult> {
	const child = Bun.spawn([...options.command], {
		cwd: options.cwd,
		env: stringEnv(options.env),
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const timeout = setTimeout(() => child.kill(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	clearTimeout(timeout);
	return { stdout, stderr, exitCode };
}

/** Find a response by command name. */
export function findResponse(records: readonly RpcRecord[], command: string): RpcRecord | undefined {
	return records.find((record) => record.type === "response" && record.command === command);
}
