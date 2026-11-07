/**
 * Fork route check for fix-managed-rlm-child-model.
 *
 * The fork route is the built `spirits` binary with the extension compiled in, so it exercises the
 * product code without the managed Pi launch. Same isolation as the compatibility runner: temp HOME,
 * temp agent dir, local fake provider, no real credentials.
 *
 *   physical  - parent on a physical model, no abort
 *   abort     - parent on a physical model, aborted while the child request is in flight
 *   auto      - parent on the virtual `spirits/auto` model, no abort
 *
 * For each case it records the model name of every provider request, and the `provider` / `modelId` /
 * `outcome` of every `rlm_usage` entry, which is what tells the resolved child model from the parent's
 * selection.
 */

import { join } from "node:path";
import { createCompatRunner } from "../../../../scripts/managed-pi-compat/runner.ts";
import {
	startFakeProvider,
	type FakeReply,
	type FakeToolCall,
} from "../../../../scripts/managed-pi-compat/fake-provider.ts";
import {
	findResponse,
	runAbortRpcProbe,
	runRpcProbe,
	type RpcRecord,
} from "../../../../scripts/managed-pi-compat/rpc.ts";
import {
	isVirtualRequestedModel,
	rlmUsageOutcome,
	writeRlmFixture,
} from "../../../../scripts/managed-pi-compat/rlm.ts";

// The harness helpers live in the same checkout as this file, so the probe runs from any worktree
// without editing paths. Only the binary under test is passed in.
const CHECKOUT = join(import.meta.dirname, "../../../..");
const FORK = process.env.SPIRITS_FORK_BINARY ?? join(CHECKOUT, "dist/spirits-linux-x64");
const PROVIDER = join(CHECKOUT, "scripts/managed-pi-compat/fixtures/custom-provider.ts");
const CHILD_DELAY_MS = 8000;
const ABORT_AFTER_MS = 3000;
const STOP_SETTLE_MS = 700;
const PARENT_PROMPT = "run one rlm cell";
const RLM_CELL_CODE = 'return await rlm("child task")';
const FAKE_PROVIDER_ENV = "MANAGED_PI_COMPAT_FAKE_PROVIDER_URL";

function usageOf(records: readonly RpcRecord[], id: string): Array<Record<string, unknown>> {
	const source = records.filter((record) => record.type === "response" && record.id === id);
	const response = source.length > 0 ? (source[source.length - 1] as RpcRecord) : undefined;
	const entries = (response?.data as { entries?: Array<Record<string, unknown>> } | undefined)?.entries ?? [];
	return entries.filter((entry) => entry.type === "custom" && entry.customType === "rlm_usage");
}

/** Every `rlm_usage` read taken during the poll phase, with the model the product recorded. */
function usageReads(records: readonly RpcRecord[]): Array<{ id: string; entries: unknown[] }> {
	const reads: Array<{ id: string; entries: unknown[] }> = [];
	for (const record of records) {
		if (record.type !== "response" || !record.id?.includes("entries-poll")) continue;
		const entries = usageOf(records, record.id);
		if (entries.length > 0) reads.push({ id: record.id, entries: entries.map(summarizeUsage) });
	}
	return reads;
}

function summarizeUsage(entry: Record<string, unknown>): Record<string, unknown> {
	const data = (entry.data ?? {}) as Record<string, unknown>;
	return { outcome: rlmUsageOutcome(entry), provider: data.provider, modelId: data.modelId, sessionId: data.sessionId === null ? null : typeof data.sessionId === "string" ? "set" : undefined };
}

async function probe(caseName: string, model: { provider: string; modelId: string }, withAbort: boolean) {
	const runner = await createCompatRunner({ mode: "official" });
	const toolCall: FakeToolCall = { name: "tsrepl", arguments: { code: RLM_CELL_CODE } };
	const reply = (body: unknown): FakeReply => {
		const messages = (body as { messages?: Array<{ role?: string }> } | undefined)?.messages ?? [];
		if (messages.some((message) => message.role === "tool")) return { kind: "text", text: "finished" };
		return JSON.stringify(body ?? "").includes(PARENT_PROMPT)
			? { kind: "tool-call", toolCall }
			: { kind: "text", text: "child answer", delayMs: CHILD_DELAY_MS };
	};
	const provider = startFakeProvider(toolCall, { reply });
	try {
		await writeRlmFixture({ agentDir: runner.agentDir, providerBaseUrl: provider.baseUrl });
		const env = runner.env({ [FAKE_PROVIDER_ENV]: provider.baseUrl });
		const command = [FORK, "--mode", "rpc", "--no-session", "-e", PROVIDER];
		const requests = [
			{ id: "model-1", type: "set_model", provider: model.provider, modelId: model.modelId },
			{ id: "prompt-1", type: "prompt", message: PARENT_PROMPT },
		];
		const children = () => provider.requests.filter((request) => request.delayMs === CHILD_DELAY_MS);
		const stopped = (): boolean => {
			const inflight = children();
			if (inflight.length === 0) return false;
			if (!inflight.every((request) => request.closedAt !== undefined)) return false;
			const lastClose = Math.max(...inflight.map((request) => request.closedAt ?? 0));
			return Date.now() - lastClose >= STOP_SETTLE_MS;
		};
		const common = { command, cwd: runner.workRoot, env };
		const result = withAbort
			? await runAbortRpcProbe({
					...common,
					requests,
					abortRequest: { id: "abort-1", type: "abort" },
					abortAfterMs: ABORT_AFTER_MS,
					timeoutMs: 90_000,
					waitFor: (records) => records.some((record) => record.type === "agent_settled"),
					poll: {
						request: { id: "entries-poll", type: "get_entries" },
						intervalMs: 400,
						timeoutMs: 15_000,
						until: stopped,
					},
				})
			: await runRpcProbe({
					...common,
					requests,
					timeoutMs: 90_000,
					waitFor: (records) => records.some((record) => record.type === "agent_settled"),
					settleRequests: [{ id: "entries-1", type: "get_entries" }],
				});
		const end = result.records.find((record) => record.type === "tool_execution_end");
		// The child's own request: not the parent prompt, and not a continuation carrying a tool result.
		const childRequest = provider.requests.find((request) => {
			const messages = (request.body as { messages?: Array<{ role?: string }> } | undefined)?.messages ?? [];
			if (messages.some((message) => message.role === "tool")) return false;
			return !JSON.stringify(request.body ?? "").includes(PARENT_PROMPT);
		});
		return {
			case: caseName,
			abortSent: result.abortSent === true,
			providerRequests: provider.requests.map((request) => ({
				kind: request.kind,
				model: request.model,
				receivedAt: request.receivedAt,
				respondedAt: request.respondedAt,
				...(request.closedAt === undefined ? {} : { closedAt: request.closedAt }),
				...(request.delayMs === undefined ? {} : { delayMs: request.delayMs }),
			})),
			childRequests: children().length,
			childRequestedModel: childRequest?.model,
			childModelIsVirtual: isVirtualRequestedModel(childRequest?.model),
			childClosedEarly: children().some(
				(request) => request.closedAt !== undefined && request.respondedAt === undefined,
			),
			cellText: JSON.stringify(end?.result ?? "").slice(0, 400),
			cellIsError: end?.isError === true,
			usageAtSettled: usageOf(result.records, "entries-1").map(summarizeUsage),
			usagePolls: usageReads(result.records),
			stderr: result.stderr.slice(0, 400),
			exitCode: result.exitCode,
		};
	} finally {
		provider.stop();
		await runner.cleanup();
	}
}

const report = [];
for (const [name, model, abort] of [
	["physical", { provider: "compat-fake", modelId: "fake-model" }, false],
	["abort", { provider: "compat-fake", modelId: "fake-model" }, true],
	["auto", { provider: "spirits", modelId: "auto" }, false],
] as const) {
	report.push(await probe(name, model, abort));
}
const forkFile = Bun.file(FORK);
if (!(await forkFile.exists())) {
	throw new Error(`fork binary not found: ${FORK} (build it with \`bun scripts/build-binaries.ts --version <version>\`)`);
}
const forkSha256 = new Bun.CryptoHasher("sha256").update(await forkFile.arrayBuffer()).digest("hex");
console.log(JSON.stringify({ fork: FORK, forkSha256, cases: report }, null, "\t"));
