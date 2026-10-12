import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "../../src/index.ts";
import { getMessageText } from "./harness.ts";

interface SummaryMessage {
	role: string;
	text: string;
}

function summarizeMessages(messages: readonly unknown[]): SummaryMessage[] {
	return messages.map((message) => ({
		role: (message as { role: string }).role,
		text: getMessageText(message),
	}));
}

describe("AgentSessionRuntime.clearConversation", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	async function createRuntimeForTest(
		extensionFactory: ExtensionFactory = () => {},
		options?: { bootstrapModel?: boolean; bootstrapThinkingLevel?: boolean },
	) {
		const tempDir = join(tmpdir(), `pi-runtime-clear-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const faux = registerFauxProvider({
			models: [
				{ id: "faux-1", reasoning: true },
				{ id: "faux-2", reasoning: false },
			],
		});

		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));

		const runtimeOptions = {
			agentDir: tempDir,
			authStorage,
			model: options?.bootstrapModel === false ? undefined : faux.getModel(),
			thinkingLevel: options?.bootstrapThinkingLevel === false ? undefined : undefined,
			resourceLoaderOptions: {
				extensionFactories: [
					(pi: ExtensionAPI) => {
						pi.registerProvider(faux.getModel().provider, {
							baseUrl: faux.getModel().baseUrl,
							apiKey: "faux-key",
							api: faux.api,
							models: faux.models.map((registeredModel) => ({
								id: registeredModel.id,
								name: registeredModel.name,
								api: registeredModel.api,
								reasoning: registeredModel.reasoning,
								input: registeredModel.input,
								cost: registeredModel.cost,
								contextWindow: registeredModel.contextWindow,
								maxTokens: registeredModel.maxTokens,
							})),
						});
						extensionFactory(pi);
					},
				],
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				...runtimeOptions,
				cwd,
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: runtimeOptions.model,
					thinkingLevel: runtimeOptions.thinkingLevel,
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.create(tempDir),
		});
		await runtime.session.bindExtensions({});

		cleanups.push(async () => {
			await runtime.dispose();
			faux.unregister();
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});

		return { runtime, faux, tempDir };
	}

	it("re-roots the branch and copies custom entries in order", async () => {
		const { runtime } = await createRuntimeForTest();
		const sessionManager = runtime.session.sessionManager;
		sessionManager.appendCustomEntry("spirits_goal", { goal: "one" });
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "hello" }],
			timestamp: Date.now(),
		});
		sessionManager.appendCustomEntry("spirits_memory", { file: "notes.md" });
		const previousLeafId = sessionManager.getLeafId();

		const result = runtime.clearConversation();

		expect(result).toEqual({ cleared: true });
		const branch = sessionManager.getBranch();
		expect(branch.some((entry) => entry.type === "message")).toBe(false);
		expect(branch.some((entry) => entry.id === previousLeafId)).toBe(false);
		expect(branch[0]?.parentId ?? null).toBe(null);
		expect(branch.map((entry) => entry.type)).toEqual(["model_change", "thinking_level_change", "custom", "custom"]);
		const customs = branch.filter((entry) => entry.type === "custom");
		expect(customs.map((entry) => [entry.customType, entry.data])).toEqual([
			["spirits_goal", { goal: "one" }],
			["spirits_memory", { file: "notes.md" }],
		]);
	});

	it("keeps the runtime model and thinking level after reopen", async () => {
		const { runtime, faux } = await createRuntimeForTest(undefined, {
			bootstrapModel: false,
			bootstrapThinkingLevel: false,
		});
		faux.setResponses([fauxAssistantMessage("one")]);
		await runtime.session.setModel(faux.getModel("faux-1")!);
		runtime.session.setThinkingLevel("high");
		await runtime.session.prompt("hello");
		const sessionFile = runtime.session.sessionFile!;

		const result = runtime.clearConversation();
		expect(result).toEqual({ cleared: true });
		expect(runtime.session.model?.id).toBe("faux-1");
		expect(runtime.session.thinkingLevel).toBe("high");

		await runtime.switchSession(sessionFile);
		await runtime.session.bindExtensions({});
		expect(runtime.session.model?.id).toBe("faux-1");
		expect(runtime.session.thinkingLevel).toBe("high");
	});

	it("sends only the new user message after clear", async () => {
		const requests: SummaryMessage[][] = [];
		const { runtime, faux } = await createRuntimeForTest();
		faux.setResponses([
			(context) => {
				requests.push(summarizeMessages(context.messages));
				return fauxAssistantMessage("old response");
			},
			(context) => {
				requests.push(summarizeMessages(context.messages));
				return fauxAssistantMessage("new response");
			},
		]);
		await runtime.session.prompt("old turn");
		runtime.session.sessionManager.appendCompaction("summary of old turn", null, 100);

		const result = runtime.clearConversation();
		expect(result).toEqual({ cleared: true });
		await runtime.session.prompt("hello");

		const helloRequest = requests.at(-1)!;
		expect(helloRequest.filter((message) => message.role !== "system")).toEqual([{ role: "user", text: "hello" }]);
	});

	it("reports zero context usage after clear", async () => {
		const { runtime, faux } = await createRuntimeForTest();
		faux.setResponses([fauxAssistantMessage("one")]);
		await runtime.session.prompt("hello");
		expect(runtime.session.getContextUsage()?.tokens).toBeGreaterThan(0);

		const result = runtime.clearConversation();

		expect(result).toEqual({ cleared: true });
		expect(runtime.session.getContextUsage()?.tokens).toBe(0);
	});

	it("keeps the session id and file and leaves the previous branch on disk", async () => {
		const { runtime, faux } = await createRuntimeForTest();
		faux.setResponses([fauxAssistantMessage("one")]);
		await runtime.session.prompt("hello");
		const sessionId = runtime.session.sessionId;
		const sessionFile = runtime.session.sessionFile!;
		expect(existsSync(sessionFile)).toBe(true);

		const result = runtime.clearConversation();

		expect(result).toEqual({ cleared: true });
		expect(runtime.session.sessionId).toBe(sessionId);
		expect(runtime.session.sessionFile).toBe(sessionFile);
		expect(readFileSync(sessionFile, "utf8")).toContain("hello");
		expect(runtime.session.sessionManager.getBranch().some((entry) => entry.type === "message")).toBe(false);
		expect(runtime.session.sessionManager.getEntries().some((entry) => entry.type === "message")).toBe(true);
	});

	it("reopening the file restores the cleared branch", async () => {
		const { runtime, faux } = await createRuntimeForTest();
		faux.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
		await runtime.session.prompt("old");
		const sessionFile = runtime.session.sessionFile!;
		runtime.clearConversation();
		await runtime.session.prompt("fresh");

		await runtime.switchSession(sessionFile);
		await runtime.session.bindExtensions({});

		expect(
			runtime.session.messages
				.filter((message) => message.role === "user")
				.map((message) => getMessageText(message)),
		).toEqual(["fresh"]);
	});

	it("navigating to the previous leaf restores the old conversation", async () => {
		const { runtime, faux } = await createRuntimeForTest();
		faux.setResponses([fauxAssistantMessage("one")]);
		await runtime.session.prompt("hello");
		const previousLeafId = runtime.session.sessionManager.getLeafId()!;

		runtime.clearConversation();
		expect(runtime.session.messages.filter((message) => message.role === "user")).toEqual([]);

		const result = await runtime.session.navigateTree(previousLeafId);

		expect(result.cancelled).toBe(false);
		expect(
			runtime.session.messages
				.filter((message) => message.role === "user")
				.map((message) => getMessageText(message)),
		).toEqual(["hello"]);
	});

	it("refuses while streaming and keeps queued messages", async () => {
		let toolStarted!: () => void;
		const toolStartedPromise = new Promise<void>((resolve) => {
			toolStarted = resolve;
		});
		const { runtime, faux } = await createRuntimeForTest((pi: ExtensionAPI) => {
			pi.registerTool({
				name: "block",
				label: "Block",
				description: "Blocks until aborted",
				parameters: Type.Object({}),
				execute: (_toolCallId, _params, signal) =>
					new Promise<AgentToolResult<unknown>>((resolve) => {
						toolStarted();
						signal?.addEventListener("abort", () =>
							resolve({ content: [{ type: "text", text: "tool aborted" }], details: {} }),
						);
					}),
			});
		});
		faux.setResponses([fauxAssistantMessage(fauxToolCall("block", {}), { stopReason: "toolUse" })]);
		const promptPromise = runtime.session.prompt("start");
		await toolStartedPromise;
		await runtime.session.prompt("queued", { streamingBehavior: "followUp" });

		const result = runtime.clearConversation();

		expect(result).toEqual({ cleared: false, reason: "streaming" });
		expect(runtime.session.getFollowUpMessages()).toEqual(["queued"]);
		await runtime.session.abort();
		await promptPromise;
	});

	it("refuses while compacting", async () => {
		let markCompactionStarted = () => {};
		const compactionStarted = new Promise<void>((resolve) => {
			markCompactionStarted = resolve;
		});
		let releaseCompaction = () => {};
		const compactionRelease = new Promise<void>((resolve) => {
			releaseCompaction = resolve;
		});
		const { runtime } = await createRuntimeForTest((pi: ExtensionAPI) => {
			pi.on("session_before_compact", async (event) => {
				markCompactionStarted();
				await compactionRelease;
				return {
					compaction: {
						summary: "summary",
						firstKeptEntryId: event.preparation.firstKeptEntryId,
						tokensBefore: event.preparation.tokensBefore,
					},
				};
			});
		});
		runtime.session.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
		runtime.session.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "to compact" }],
			timestamp: Date.now() - 1000,
		});
		runtime.session.sessionManager.appendMessage({
			...fauxAssistantMessage("assistant response to compact"),
			timestamp: Date.now() - 500,
		});
		runtime.session.refreshContext();

		const compactPromise = runtime.session.compact();
		await compactionStarted;

		const result = runtime.clearConversation();

		expect(result).toEqual({ cleared: false, reason: "compacting" });
		releaseCompaction();
		await compactPromise;
	});

	it("succeeds on a session without messages", async () => {
		const { runtime } = await createRuntimeForTest();

		const result = runtime.clearConversation();

		expect(result).toEqual({ cleared: true });
		expect(runtime.session.sessionManager.getBranch().some((entry) => entry.type === "message")).toBe(false);
	});

	it("keeps the same AgentSession and emits no session_start or session_shutdown", async () => {
		const events: string[] = [];
		const { runtime } = await createRuntimeForTest((pi: ExtensionAPI) => {
			pi.on("session_start", () => {
				events.push("session_start");
			});
			pi.on("session_shutdown", () => {
				events.push("session_shutdown");
			});
		});
		const session = runtime.session;
		const eventsBeforeClear = [...events];

		const result = runtime.clearConversation();

		expect(result).toEqual({ cleared: true });
		expect(runtime.session).toBe(session);
		expect(events).toEqual(eventsBeforeClear);
	});
});
