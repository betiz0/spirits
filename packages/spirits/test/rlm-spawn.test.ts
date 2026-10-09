import { expect, test } from "bun:test";
import type {
	AgentMessage,
	AgentSession,
	AgentSessionEvent,
	CreateAgentSessionOptions,
	SessionManager,
	SessionStats,
} from "@earendil-works/pi-coding-agent";
import { createTsreplTool } from "../src/tools.ts";
import {
	type RlmResourceLoaderOptions,
	type SpawnParams,
	type SpawnSdk,
	spawnChildSession,
} from "../src/rlm/spawn.ts";

const MODEL = { provider: "p", id: "m" };

const CHILD_TOOL = createTsreplTool();

const DEFAULT_STATS: SessionStats = {
	tokens: { input: 100, output: 20, cacheRead: 5, cacheWrite: 0, total: 120 },
	cost: 0.01,
};

class FakeSession implements AgentSession {
	sessionId = "child-1";
	messages: AgentMessage[] = [];
	abortCalls = 0;
	disposeCalls = 0;
	unsubscribeCalls = 0;
	lastText: string | undefined = "answer";
	stats: SessionStats = DEFAULT_STATS;
	abortGate: Promise<void> = Promise.resolve();
	onAbort: (() => void) | undefined;
	promptImpl: (text: string) => Promise<void> = async () => {};
	readonly promptTexts: string[] = [];
	#listeners = new Set<(event: AgentSessionEvent) => void>();

	async prompt(text: string): Promise<void> {
		this.promptTexts.push(text);
		await this.promptImpl(text);
	}

	async abort(): Promise<void> {
		this.abortCalls++;
		this.onAbort?.();
		await this.abortGate;
	}

	getLastAssistantText(): string | undefined {
		return this.lastText;
	}

	getSessionStats(): SessionStats {
		return this.stats;
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.unsubscribeCalls++;
			this.#listeners.delete(listener);
		};
	}

	dispose(): void {
		this.disposeCalls++;
	}

	emit(event: AgentSessionEvent): void {
		for (const listener of [...this.#listeners]) {
			listener(event);
		}
	}
}

class FakeSdk implements SpawnSdk {
	session = new FakeSession();
	sessionManager = {} as SessionManager;
	sessionManagerCwds: string[] = [];
	createOptions: CreateAgentSessionOptions | undefined;
	createCalls = 0;
	createError: Error | undefined;
	createGate: Promise<void> = Promise.resolve();
	loaderOptions: RlmResourceLoaderOptions | undefined;
	reloadCalls = 0;
	readonly events: string[] = [];
	loader = {
		reload: async (): Promise<void> => {
			this.reloadCalls++;
			this.events.push("reload");
		},
	};

	async createAgentSession(options: CreateAgentSessionOptions): Promise<{ session: AgentSession }> {
		this.events.push("createAgentSession");
		this.createOptions = options;
		this.createCalls++;
		if (this.createError !== undefined) {
			throw this.createError;
		}
		await this.createGate;
		return { session: this.session };
	}

	createSessionManager(cwd: string): SessionManager {
		this.sessionManagerCwds.push(cwd);
		return this.sessionManager;
	}

	createResourceLoader(options: RlmResourceLoaderOptions): { reload: () => Promise<void> } {
		this.loaderOptions = options;
		return this.loader;
	}
}

function makeParams(overrides: Partial<SpawnParams> = {}): SpawnParams {
	return {
		prompt: "task",
		cwd: "/work",
		model: MODEL,
		signal: new AbortController().signal,
		childTool: CHILD_TOOL,
		...overrides,
	};
}

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

test("child session options", async () => {
	const sdk = new FakeSdk();
	const result = await spawnChildSession(makeParams({ cwd: "/work" }), sdk);

	expect(result.outcome).toBe("completed");
	expect(sdk.createOptions?.cwd).toBe("/work");
	expect(sdk.createOptions?.model).toEqual(MODEL);
	expect(sdk.sessionManagerCwds).toEqual(["/work"]);
	expect(sdk.createOptions?.sessionManager).toBe(sdk.sessionManager);
	expect(sdk.createOptions?.resourceLoader).toBe(sdk.loader);
});

test("thinking level omitted when unset", async () => {
	const sdk = new FakeSdk();
	await spawnChildSession(makeParams(), sdk);
	expect(sdk.createOptions !== undefined && "thinkingLevel" in sdk.createOptions).toBe(false);
});

test("thinking level passed when set", async () => {
	const sdk = new FakeSdk();
	await spawnChildSession(makeParams({ thinkingLevel: "high" }), sdk);
	expect(sdk.createOptions?.thinkingLevel).toBe("high");
});

test("resource loader options", async () => {
	const sdk = new FakeSdk();
	await spawnChildSession(makeParams({ cwd: "/work" }), sdk);

	expect(sdk.reloadCalls).toBe(1);
	expect(sdk.events).toEqual(["reload", "createAgentSession"]);
	expect(sdk.loaderOptions?.cwd).toBe("/work");
	expect(typeof sdk.loaderOptions?.agentDir).toBe("string");
	expect(sdk.loaderOptions?.noExtensions).toBe(true);
	expect(sdk.loaderOptions?.noSkills).toBe(true);
	expect(sdk.loaderOptions?.noPromptTemplates).toBe(true);
	expect(Object.keys(sdk.loaderOptions ?? {}).sort()).toEqual([
		"agentDir",
		"cwd",
		"noExtensions",
		"noPromptTemplates",
		"noSkills",
	]);
});

test("child tools tsrepl only", async () => {
	const sdk = new FakeSdk();
	await spawnChildSession(makeParams(), sdk);
	expect(sdk.createOptions?.tools).toEqual(["tsrepl"]);
	expect(sdk.createOptions?.customTools).toEqual([CHILD_TOOL]);
});

test("completed returns final text and usage", async () => {
	const sdk = new FakeSdk();
	const result = await spawnChildSession(makeParams({ prompt: "do it" }), sdk);

	expect(sdk.session.promptTexts).toEqual(["do it"]);
	expect(result).toEqual({
		outcome: "completed",
		text: "answer",
		sessionId: "child-1",
		tokens: DEFAULT_STATS.tokens,
		cost: DEFAULT_STATS.cost,
	});
});

test("provider error becomes error outcome", async () => {
	const sdk = new FakeSdk();
	sdk.session.messages = [{ role: "assistant", stopReason: "error", errorMessage: "rate limit" }];
	const result = await spawnChildSession(makeParams(), sdk);

	expect(result.outcome).toBe("error");
	expect(result.errorMessage).toBe("rate limit");
	expect(result.sessionId).toBe("child-1");
	expect(result.tokens).toEqual(DEFAULT_STATS.tokens);
	expect(result.cost).toBe(DEFAULT_STATS.cost);
});

test("unexpected abort becomes error", async () => {
	const sdk = new FakeSdk();
	sdk.session.messages = [{ role: "assistant", stopReason: "aborted" }];
	const result = await spawnChildSession(makeParams(), sdk);

	expect(result.outcome).toBe("error");
	expect(result.errorMessage).toContain("unexpectedly");
	expect(result.tokens).toEqual(DEFAULT_STATS.tokens);
});

test("prompt throw becomes error with usage", async () => {
	const sdk = new FakeSdk();
	sdk.session.promptImpl = async () => {
		throw new Error("prompt boom");
	};
	const result = await spawnChildSession(makeParams(), sdk);

	expect(result.outcome).toBe("error");
	expect(result.errorMessage).toBe("prompt boom");
	expect(result.sessionId).toBe("child-1");
	expect(result.tokens).toEqual(DEFAULT_STATS.tokens);
	expect(result.cost).toBe(DEFAULT_STATS.cost);
});

test("session creation failure returns error with zero usage", async () => {
	const sdk = new FakeSdk();
	sdk.createError = new Error("no session");
	const result = await spawnChildSession(makeParams(), sdk);

	expect(result.outcome).toBe("error");
	expect(result.errorMessage).toBe("no session");
	expect(result.sessionId).toBeNull();
	expect(result.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
	expect(result.cost).toBe(0);
});

test("usage returned on abort", async () => {
	const sdk = new FakeSdk();
	const controller = new AbortController();
	sdk.session.promptImpl = () =>
		new Promise<void>((resolve) => {
			controller.signal.addEventListener("abort", () => resolve(), { once: true });
		});

	const promise = spawnChildSession(makeParams({ signal: controller.signal }), sdk);
	await tick();
	controller.abort();
	const result = await promise;

	expect(result.outcome).toBe("aborted");
	expect(result.tokens).toEqual(DEFAULT_STATS.tokens);
	expect(result.cost).toBe(DEFAULT_STATS.cost);
});

test("dispose on completion", async () => {
	const sdk = new FakeSdk();
	await spawnChildSession(makeParams(), sdk);
	expect(sdk.session.disposeCalls).toBe(1);
	expect(sdk.session.unsubscribeCalls).toBe(1);
});

test("abort stops child", async () => {
	const sdk = new FakeSdk();
	const controller = new AbortController();
	sdk.session.promptImpl = () =>
		new Promise<void>((resolve) => {
			controller.signal.addEventListener("abort", () => resolve(), { once: true });
		});

	const promise = spawnChildSession(makeParams({ signal: controller.signal }), sdk);
	await tick();
	controller.abort();
	const result = await promise;

	expect(sdk.session.abortCalls).toBe(1);
	expect(result.outcome).toBe("aborted");
	expect(result.tokens).toEqual(DEFAULT_STATS.tokens);
	expect(result.cost).toBe(DEFAULT_STATS.cost);
});

test("abort awaited before dispose", async () => {
	const sdk = new FakeSdk();
	const controller = new AbortController();
	let release: () => void = () => {};
	sdk.session.abortGate = new Promise<void>((resolve) => {
		release = resolve;
	});
	sdk.session.promptImpl = () =>
		new Promise<void>((resolve) => {
			controller.signal.addEventListener("abort", () => resolve(), { once: true });
		});

	const promise = spawnChildSession(makeParams({ signal: controller.signal }), sdk);
	await tick();
	controller.abort();
	await tick();

	expect(sdk.session.abortCalls).toBe(1);
	expect(sdk.session.disposeCalls).toBe(0);

	release();
	const result = await promise;
	expect(result.outcome).toBe("aborted");
	expect(sdk.session.disposeCalls).toBe(1);
});

test("abort listener removed on completion", async () => {
	const sdk = new FakeSdk();
	const controller = new AbortController();
	const result = await spawnChildSession(makeParams({ signal: controller.signal }), sdk);
	controller.abort();
	expect(sdk.session.abortCalls).toBe(0);
	expect(result.outcome).toBe("completed");
});

test("abort not called without signal abort", async () => {
	const sdk = new FakeSdk();
	await spawnChildSession(makeParams(), sdk);
	expect(sdk.session.abortCalls).toBe(0);
});

test("budget aborts child at 51st call", async () => {
	const sdk = new FakeSdk();
	let resolvePrompt: () => void = () => {};
	sdk.session.promptImpl = () =>
		new Promise<void>((resolve) => {
			resolvePrompt = resolve;
		});
	sdk.session.onAbort = () => resolvePrompt();

	const promise = spawnChildSession(makeParams(), sdk);
	await tick();
	for (let i = 0; i < 50; i++) {
		sdk.session.emit({ type: "tool_execution_start", toolName: "tsrepl" });
	}
	expect(sdk.session.abortCalls).toBe(0);

	sdk.session.emit({ type: "tool_execution_start", toolName: "tsrepl" });
	const result = await promise;

	expect(sdk.session.abortCalls).toBe(1);
	expect(result.outcome).toBe("budget");
});

test("budget boundary 50 completes", async () => {
	const sdk = new FakeSdk();
	let resolvePrompt: () => void = () => {};
	sdk.session.promptImpl = () =>
		new Promise<void>((resolve) => {
			resolvePrompt = resolve;
		});

	const promise = spawnChildSession(makeParams(), sdk);
	await tick();
	for (let i = 0; i < 50; i++) {
		sdk.session.emit({ type: "tool_execution_start", toolName: "tsrepl" });
	}
	resolvePrompt();
	const result = await promise;

	expect(sdk.session.abortCalls).toBe(0);
	expect(result.outcome).toBe("completed");
});

test("partial summary shape", async () => {
	const sdk = new FakeSdk();
	let resolvePrompt: () => void = () => {};
	sdk.session.promptImpl = () =>
		new Promise<void>((resolve) => {
			resolvePrompt = resolve;
		});
	sdk.session.onAbort = () => resolvePrompt();
	sdk.session.lastText = "partial answer";

	const promise = spawnChildSession(makeParams(), sdk);
	await tick();
	for (let i = 0; i < 51; i++) {
		sdk.session.emit({ type: "tool_execution_start", toolName: "tsrepl" });
	}
	const result = await promise;

	expect(result.outcome).toBe("budget");
	expect(result.text).toContain("50");
	expect(result.text).toContain("partial answer");
});

test("usage returned on budget", async () => {
	const sdk = new FakeSdk();
	let resolvePrompt: () => void = () => {};
	sdk.session.promptImpl = () =>
		new Promise<void>((resolve) => {
			resolvePrompt = resolve;
		});
	sdk.session.onAbort = () => resolvePrompt();

	const promise = spawnChildSession(makeParams(), sdk);
	await tick();
	for (let i = 0; i < 51; i++) {
		sdk.session.emit({ type: "tool_execution_start", toolName: "tsrepl" });
	}
	const result = await promise;

	expect(result.tokens).toEqual(DEFAULT_STATS.tokens);
	expect(result.cost).toBe(DEFAULT_STATS.cost);
});

test("abort before creation skips prompt", async () => {
	const sdk = new FakeSdk();
	const controller = new AbortController();
	controller.abort();

	const result = await spawnChildSession(makeParams({ signal: controller.signal }), sdk);

	expect(result.outcome).toBe("aborted");
	expect(result.sessionId).toBeNull();
	expect(result.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
	expect(result.cost).toBe(0);
	expect(sdk.createCalls).toBe(0);
	expect(sdk.reloadCalls).toBe(0);
	expect(sdk.session.promptTexts).toEqual([]);
});

test("abort during creation skips prompt", async () => {
	const sdk = new FakeSdk();
	const controller = new AbortController();
	let releaseCreate: () => void = () => {};
	sdk.createGate = new Promise<void>((resolve) => {
		releaseCreate = resolve;
	});

	const promise = spawnChildSession(makeParams({ signal: controller.signal }), sdk);
	await tick();
	controller.abort();
	releaseCreate();
	const result = await promise;

	expect(result.outcome).toBe("aborted");
	expect(result.sessionId).toBe("child-1");
	expect(result.tokens).toEqual(DEFAULT_STATS.tokens);
	expect(sdk.session.promptTexts).toEqual([]);
	expect(sdk.session.disposeCalls).toBe(1);
});

test("abort reissued at agent start", async () => {
	const sdk = new FakeSdk();
	const controller = new AbortController();
	let agentStarted = false;
	let resolvePrompt: () => void = () => {};
	sdk.session.promptImpl = () =>
		new Promise<void>((resolve) => {
			resolvePrompt = resolve;
		});
	sdk.session.onAbort = () => {
		// Upstream drops an abort issued before the run starts; only the reissue can stop it.
		if (agentStarted) {
			resolvePrompt();
		}
	};

	const promise = spawnChildSession(makeParams({ signal: controller.signal }), sdk);
	await tick();
	controller.abort();
	expect(sdk.session.abortCalls).toBe(1);

	agentStarted = true;
	sdk.session.emit({ type: "agent_start" });
	const result = await promise;

	expect(sdk.session.abortCalls).toBe(2);
	expect(result.outcome).toBe("aborted");
});

test("dispose failure keeps result", async () => {
	const sdk = new FakeSdk();
	sdk.session.dispose = () => {
		throw new Error("dispose boom");
	};

	const result = await spawnChildSession(makeParams(), sdk);

	expect(result.outcome).toBe("completed");
	expect(result.text).toBe("answer");
});
