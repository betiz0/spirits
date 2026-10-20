/**
 * Pins the pi half of the routing record spirits writes on `session_start`
 * (add-model-role-setting design Decision 6): pi owns the custom entry type and the reader behind the
 * footer badge, and a new session still carries no message entry when pi fires `session_start`.
 *
 * If the first test fails, pi renamed the entry type or one of its data fields: the badge stops showing
 * the role spirits recorded, and the router loses the state spirits carried over. If the second fails, pi
 * reads as an already-asked session a branch it just created, and the default role stops being recorded
 * on new sessions: the badge stays empty until the first request.
 */

import { expect, test } from "bun:test";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { getVirtualModelEntry, VIRTUAL_MODEL_STATE_ENTRY } from "@earendil-works/pi-coding-agent/core/virtual-models";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MODEL_ROLE_STRONG,
	ROUTING_MODEL_ID,
	ROUTING_PROVIDER_ID,
	ROUTING_STATE_ENTRY_TYPE,
} from "../../src/constants.ts";

/** A physical model of a provider with credentials, registered without network access. */
const PHYSICAL_PROVIDER = "pin-physical";
const PHYSICAL_MODEL = "small";

/** Credential store without entries, so the run never reads the operator's credential file. */
const credentials = {
	read: async () => undefined,
	list: async () => [],
	modify: async () => undefined,
	delete: async () => {},
};

/** Catalog cache without entries, so no stored model catalog reaches the assertion. */
const modelsStore = { read: async () => undefined, write: async () => {}, delete: async () => {} };

// spec "dual-model-routing / ロールの記録と復元": 既定ロールで開始する
test("pi reads the routing record spirits writes under its own entry type", () => {
	// The extension API exposes no way to read pi's constant, so spirits mirrors it. This is the mirror.
	expect(ROUTING_STATE_ENTRY_TYPE).toBe(VIRTUAL_MODEL_STATE_ENTRY);

	const state = { target: "claude-opus-4-7" };
	const sessionManager = SessionManager.inMemory();
	// The write `pi.appendEntry(ROUTING_STATE_ENTRY_TYPE, …)` performs.
	sessionManager.appendCustomEntry(ROUTING_STATE_ENTRY_TYPE, {
		provider: ROUTING_PROVIDER_ID,
		modelId: ROUTING_MODEL_ID,
		state,
		role: MODEL_ROLE_STRONG,
	});

	// The same branch scan pi does for the badge role and for the state it hands the router.
	expect(getVirtualModelEntry(sessionManager.getBranch(), ROUTING_PROVIDER_ID, ROUTING_MODEL_ID)).toEqual({
		provider: ROUTING_PROVIDER_ID,
		modelId: ROUTING_MODEL_ID,
		state,
		role: MODEL_ROLE_STRONG,
	});
});

/** What the loaded extension saw when pi fired `session_start`. */
interface RecordedStart {
	reason: string;
	/** Entry types of the branch, root to leaf. */
	types: string[];
}

/** Extension that records the branch pi hands it on `session_start`. */
const RECORDING_EXTENSION = `export default (pi) => {
	pi.on("session_start", (event, ctx) => {
		globalThis.spiritsStart = {
			reason: event.reason,
			types: ctx.sessionManager.getBranch().map((entry) => entry.type),
		};
	});
};`;

/** Start a new session the way the CLI does: build it on the selected model, then bind extensions. */
async function startNewSession(): Promise<{ start: RecordedStart; cleanup: () => Promise<void> }> {
	const cwd = await mkdtemp(join(tmpdir(), "spirits-start-cwd-"));
	const agentDir = await mkdtemp(join(tmpdir(), "spirits-start-agent-"));
	await mkdir(join(agentDir, "extensions"), { recursive: true });
	await writeFile(join(agentDir, "extensions", "record-start.ts"), RECORDING_EXTENSION, "utf8");
	delete (globalThis as Record<string, unknown>).spiritsStart;

	const runtime = await ModelRuntime.create({
		credentials,
		modelsStore,
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider(PHYSICAL_PROVIDER, {
		apiKey: "pin-key",
		baseUrl: "http://127.0.0.1:9/pin",
		models: [
			{
				id: PHYSICAL_MODEL,
				name: "Pin Small",
				api: "openai-completions",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000,
				maxTokens: 100,
			},
		],
	});
	await runtime.refresh({ allowNetwork: false });
	const model = runtime.getModel(PHYSICAL_PROVIDER, PHYSICAL_MODEL);
	if (!model) throw new Error("the pin runtime lost its registered model");

	const { session } = await createAgentSession({
		cwd,
		agentDir,
		modelRuntime: runtime,
		sessionManager: SessionManager.inMemory(cwd),
		model,
		noTools: "all",
		sessionStartEvent: { type: "session_start", reason: "startup" },
	});
	// Binding the extensions is what fires the event, after pi applied the selected model.
	await session.bindExtensions({});

	const recorded = (globalThis as Record<string, unknown>).spiritsStart;
	return {
		start: recorded as RecordedStart,
		cleanup: async () => {
			session.dispose();
			await rm(cwd, { recursive: true, force: true });
			await rm(agentDir, { recursive: true, force: true });
		},
	};
}

// design Decision 6: 判別に reason は足りず、分岐が空でもない。message entry の有無で見る。
test("pi fires session_start on a new session whose branch carries no message entry", async () => {
	const { start, cleanup } = await startNewSession();

	try {
		expect(start.reason).toBe("startup");
		// pi's own writes before the event are the model and thinking level it applied, so the session is
		// still unasked here.
		expect(start.types.filter((type) => type === "message")).toEqual([]);
		// Not vacuously: the branch is no longer empty when the event fires, which is what makes a
		// `branch.length === 0` check useless (the regression task 6.4 caught).
		expect(start.types).toContain("model_change");
	} finally {
		await cleanup();
	}
});
