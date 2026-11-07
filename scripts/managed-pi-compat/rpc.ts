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
	/** Requests sent only after `waitFor` is satisfied (for example `get_entries` after a run). */
	settleRequests?: readonly RpcRequest[];
}

/** Result of an RPC probe. */
export interface RpcProbeResult {
	records: RpcRecord[];
	stderr: string;
	exitCode: number;
	/** Set by the abort probe: whether the abort request reached the process' stdin. */
	abortSent?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** How often a staged probe looks at the records its background reader has collected. */
const STAGE_POLL_MS = 10;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

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
	let pendingSettle = options.settleRequests ?? [];
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
		if (expected.size === 0 && pendingSettle.length > 0 && (options.waitFor?.(records) ?? true)) {
			for (const request of pendingSettle) {
				child.stdin.write(`${JSON.stringify(request)}\n`);
				expected.add(request.id);
			}
			pendingSettle = [];
			child.stdin.flush();
		}
		if (expected.size === 0 && pendingSettle.length === 0 && (options.waitFor?.(records) ?? true)) resolved = true;
	}
	child.stdin.end();
	const exitCode = await child.exited;
	await readStderr;
	await reader.cancel().catch(() => {});
	return { records, stderr, exitCode };
}

/** One stage of a staged RPC probe. */
export interface RpcStep {
	requests: readonly RpcRequest[];
	/**
	 * Finish the stage once the accumulated records show what the stage was waiting for. `since` is
	 * the record count when the stage started, so a predicate can ignore earlier stages.
	 */
	waitFor?: (records: readonly RpcRecord[], since: number) => boolean;
	timeoutMs?: number;
}

/** Options for a probe that drives one process through several stages. */
export interface StagedRpcProbeOptions {
	command: readonly string[];
	cwd: string;
	env: Record<string, string | undefined>;
	stages: readonly RpcStep[];
	timeoutMs?: number;
}

/**
 * Drive one process through several request stages.
 *
 * Session state (conversation, TODO snapshots, model selection) lives in the process, so an
 * observation that spans several actions has to run them in a single launch: seed state, read it
 * back, exercise the action, read it back again.
 */
export async function runStagedRpcProbe(options: StagedRpcProbeOptions): Promise<RpcProbeResult> {
	const child = Bun.spawn([...options.command], {
		cwd: options.cwd,
		env: stringEnv(options.env),
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
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
	let ended = false;
	// One background reader owns stdout. A stage that waits for an event which never arrives (an
	// extension command writes a file and answers nothing) must not consume or lose the records the
	// later stages produce, so stages poll the collected records instead of owning the reader.
	const stdoutReader = child.stdout.getReader();
	const drainStdout = (async () => {
		let buffer = "";
		for (;;) {
			const { done, value } = await stdoutReader.read();
			if (done) break;
			buffer += new TextDecoder().decode(value);
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline === -1) break;
				const line = buffer.slice(0, newline).replace(/\r$/, "");
				buffer = buffer.slice(newline + 1);
				if (!line.trim()) continue;
				try {
					records.push(JSON.parse(line) as RpcRecord);
				} catch {
					records.push({ type: "invalid-json", raw: line });
				}
			}
		}
		ended = true;
	})();
	for (const stage of options.stages) {
		const since = records.length;
		const expected = new Set(stage.requests.map((request) => request.id));
		for (const request of stage.requests) {
			child.stdin.write(`${JSON.stringify(request)}\n`);
		}
		child.stdin.flush();
		const deadline = Date.now() + (stage.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		for (;;) {
			for (const record of records.slice(since)) {
				if (record.type === "response" && record.id) expected.delete(record.id);
			}
			const satisfied =
				stage.waitFor === undefined
					? expected.size === 0
					: records.length > since && stage.waitFor(records, since);
			if (satisfied || ended || Date.now() >= deadline) break;
			await sleep(STAGE_POLL_MS);
		}
		if (ended) break;
	}
	child.stdin.end();
	const exitCode = await child.exited;
	await readStderr;
	await drainStdout;
	return { records, stderr, exitCode };
}

/**
 * Repeated reads after the abort, until an outside signal says the work has stopped.
 *
 * `agent_settled` is not the end of the story: a tool call that was cut short keeps running in the
 * background and can write its session entry after the run already settled. The probe therefore
 * re-reads on an interval until `until` reports the child stopped or `timeoutMs` elapses, then takes
 * one final read.
 */
export interface RpcPollOptions {
	/** Request template; each send gets the id `<id>-<attempt>` and the last one `<id>-final`. */
	request: RpcRequest;
	intervalMs: number;
	/** Keep polling at most this long after the abort. */
	timeoutMs: number;
	/** Stop polling early once this reports the work finished (for example a closed provider request). */
	until?: () => boolean;
}

/** Options for a probe that sends an abort request while the process is running. */
export interface AbortRpcProbeOptions {
	command: readonly string[];
	cwd: string;
	env: Record<string, string | undefined>;
	/** Requests sent before the abort. */
	requests: readonly RpcRequest[];
	/** Abort request sent after `abortAfterMs`. */
	abortRequest: RpcRequest;
	/** Delay before the abort request. */
	abortAfterMs: number;
	/** Send the abort only after this predicate sees the run become active. */
	abortWhen?: (records: readonly RpcRecord[]) => boolean;
	/** Extra delay after `abortWhen` is first satisfied, so a child session can start. */
	abortAfterEventMs?: number;
	timeoutMs?: number;
	/** Keep reading after the responses until this predicate sees the wanted event(s). */
	waitFor?: (records: readonly RpcRecord[]) => boolean;
	/** Requests sent after the abort and `waitFor` (for example `get_entries`). */
	settleRequests?: readonly RpcRequest[];
	/** Re-reads after the abort, replacing the single read taken at `agent_settled`. */
	poll?: RpcPollOptions;
}

/** Start a process, send requests, then send an abort and collect records. */
export async function runAbortRpcProbe(options: AbortRpcProbeOptions): Promise<RpcProbeResult> {
	const child = Bun.spawn([...options.command], {
		cwd: options.cwd,
		env: stringEnv(options.env),
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const expected = new Set(options.requests.map((request) => request.id));
	let pendingSettle = options.settleRequests ?? [];
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
	let aborted = false;
	let delayElapsed = false;
	let latestRecords: readonly RpcRecord[] = [];
	let eventSatisfiedAt: number | undefined;
	let eventTimer: ReturnType<typeof setTimeout> | undefined;
	const canAbort = (): boolean => {
		if (options.abortWhen !== undefined && !options.abortWhen(latestRecords)) return false;
		if (options.abortAfterEventMs === undefined) return true;
		// Without an `abortWhen` predicate the event gate starts at probe start.
		if (options.abortWhen === undefined) return true;
		if (eventSatisfiedAt === undefined) return false;
		return Date.now() - eventSatisfiedAt >= options.abortAfterEventMs;
	};
	const sendAbort = (): void => {
		if (aborted) return;
		if (!delayElapsed) return;
		if (!canAbort()) return;
		aborted = true;
		try {
			child.stdin.write(`${JSON.stringify(options.abortRequest)}\n`);
			child.stdin.flush();
		} catch {
			// The process may already have exited.
		}
		startPoll();
	};
	const abortTimer = setTimeout(() => {
		delayElapsed = true;
		sendAbort();
	}, options.abortAfterMs);
	// The polls send from timers and need no reader slot: a run that sits inside one tool emits
	// nothing, so the loop must not depend on records to notice the next interval.
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let pollAttempts = 0;
	let pollFinished = false;
	const startPoll = (): void => {
		const poll = options.poll;
		if (poll === undefined || pollTimer !== undefined) return;
		const pollStartedAt = Date.now();
		const sendPoll = (id: string): void => {
			try {
				child.stdin.write(`${JSON.stringify({ ...poll.request, id })}\n`);
				child.stdin.flush();
				expected.add(id);
			} catch {
				// The process may already have exited.
			}
			};
			sendPoll(`${poll.request.id}-1`);
			pollAttempts = 1;
			pollTimer = setInterval(() => {
				if (pollFinished) return;
				if (poll.until?.() === true || Date.now() - pollStartedAt >= poll.timeoutMs) {
					pollFinished = true;
					sendPoll(`${poll.request.id}-final`);
					return;
				}
				pollAttempts += 1;
				sendPoll(`${poll.request.id}-${pollAttempts}`);
			}, poll.intervalMs);
		};
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
				records.push({ type: "invalid-json", raw: line });
			}
		}
		latestRecords = records;
		if (options.abortWhen?.(records) && eventSatisfiedAt === undefined) {
			eventSatisfiedAt = Date.now();
			// Nothing else wakes the loop while the run sits inside one tool, so schedule the abort.
			eventTimer = setTimeout(sendAbort, options.abortAfterEventMs ?? 0);
		}
		if (!aborted && delayElapsed) sendAbort();
		const abortSeen = records.some(
			(record) => record.type === "response" && record.command === "abort",
		);
		// An outstanding poll holds the probe open: the reads after the abort are the measurement.
		const pollOutstanding = options.poll !== undefined && !pollFinished;
		const responsesComplete = expected.size === 0 && (aborted || abortSeen) && !pollOutstanding;
		if (responsesComplete && pendingSettle.length > 0 && (options.waitFor?.(records) ?? true)) {
			for (const request of pendingSettle) {
				child.stdin.write(`${JSON.stringify(request)}\n`);
				expected.add(request.id);
			}
			pendingSettle = [];
			child.stdin.flush();
		}
		if (responsesComplete && pendingSettle.length === 0 && (options.waitFor?.(records) ?? true)) resolved = true;
	}
	clearTimeout(abortTimer);
	if (eventTimer !== undefined) clearTimeout(eventTimer);
	if (pollTimer !== undefined) clearInterval(pollTimer);
	child.stdin.end();
	const exitCode = await child.exited;
	await readStderr;
	await reader.cancel().catch(() => {});
	return { records, stderr, exitCode, abortSent: aborted };
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
