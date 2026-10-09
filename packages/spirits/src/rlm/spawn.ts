/**
 * Child agent session creation for `rlm`.
 *
 * This is the only spirits module that imports pi values at runtime (the pi SDK). It wraps
 * `createAgentSession()` in a thin, injectable boundary so the host function logic can be tested
 * without a provider and so upstream API drift stays in one file.
 *
 * The child runs in memory, shares cwd with the parent, inherits the parent model (and thinking
 * level when set), has only `tsrepl` enabled, and loads context files but no extensions, skills,
 * or prompt templates. Aborts are forwarded to the child, and model-issued tool calls are capped.
 */

import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	type AgentSession,
	type AgentSessionEvent,
	type CreateAgentSessionOptions,
	type PiModel,
	type SessionStats,
	type ThinkingLevel,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TsreplDetails, TsreplParameters } from "../tools.ts";
import { RLM_MAX_TOOL_CALLS, countsAgainstToolBudget, isToolBudgetExceeded } from "./depth.ts";

/** Token usage copied from the child's session stats. */
export interface RlmTokens {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

export type RlmOutcome = "completed" | "aborted" | "budget" | "error";

/** Result of one child session run. */
export interface RlmRunResult {
	outcome: RlmOutcome;
	/** completed: final answer / budget: partial summary / aborted: notice / error: unused. */
	text: string;
	/** Present when `outcome` is `error`. */
	errorMessage?: string;
	/** Child session id, or null when no session was created. */
	sessionId: string | null;
	tokens: RlmTokens;
	cost: number;
}

export interface SpawnParams {
	prompt: string;
	cwd: string;
	model: PiModel;
	thinkingLevel?: ThinkingLevel;
	signal: AbortSignal;
	/** Depth +1 tsrepl tool the child session runs. */
	childTool: ToolDefinition<TsreplParameters, TsreplDetails>;
}

/** Options spirits passes to the restricted child resource loader. */
export interface RlmResourceLoaderOptions {
	cwd: string;
	agentDir: string;
	noExtensions: true;
	noSkills: true;
	noPromptTemplates: true;
}

/**
 * Injectable SDK boundary. `spawnChildSession` never touches provider APIs directly, and tests
 * substitute fakes for the three factories.
 */
export interface SpawnSdk {
	createAgentSession(options: CreateAgentSessionOptions): Promise<{ session: AgentSession }>;
	createSessionManager(cwd: string): SessionManager;
	createResourceLoader(options: RlmResourceLoaderOptions): DefaultResourceLoader;
}

export const defaultSpawnSdk: SpawnSdk = {
	createAgentSession: (options) => createAgentSession(options),
	createSessionManager: (cwd) => SessionManager.inMemory(cwd),
	createResourceLoader: (options) => new DefaultResourceLoader(options),
};

const ZERO_TOKENS: RlmTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

const ABORTED_TEXT = "子セッションを中断しました。";

/**
 * Run one child session and return its outcome.
 *
 * Creation and prompt failures become `error` results instead of throwing, so the host function
 * can record usage before deciding how to surface the failure in the cell.
 */
export async function spawnChildSession(
	params: SpawnParams,
	sdk: SpawnSdk = defaultSpawnSdk,
): Promise<RlmRunResult> {
	let session: AgentSession | undefined;
	let unsubscribe: (() => void) | undefined;
	let abortPromise: Promise<void> | undefined;
	let abortRequested = false;
	let budgetExceeded = false;
	let toolCalls = 0;

	const requestAbort = (): void => {
		abortRequested = true;
		if (session !== undefined) {
			abortPromise ??= session.abort().catch(() => {});
		}
	};
	const onSignalAbort = (): void => requestAbort();

	try {
		if (params.signal.aborted) {
			return {
				outcome: "aborted",
				text: ABORTED_TEXT,
				sessionId: null,
				tokens: ZERO_TOKENS,
				cost: 0,
			};
		}

		const resourceLoader = sdk.createResourceLoader({
			cwd: params.cwd,
			agentDir: getAgentDir(),
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
		});
		await resourceLoader.reload();

		const options: CreateAgentSessionOptions = {
			cwd: params.cwd,
			model: params.model,
			customTools: [params.childTool],
			tools: ["tsrepl"],
			sessionManager: sdk.createSessionManager(params.cwd),
			resourceLoader,
		};
		if (params.thinkingLevel !== undefined) {
			options.thinkingLevel = params.thinkingLevel;
		}

		const created = await sdk.createAgentSession(options);
		session = created.session;

		if (params.signal.aborted) {
			// Abort arrived while the session was being created. The session is idle, so calling
			// `abort()` would not stop a prompt that has not started; skip the prompt instead.
			return {
				outcome: "aborted",
				text: ABORTED_TEXT,
				sessionId: session.sessionId,
				...readUsage(session),
			};
		}
		params.signal.addEventListener("abort", onSignalAbort, { once: true });

		unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "agent_start") {
				if (abortRequested) {
					// Upstream `prompt()` resets its abort flag when the run starts, so an abort issued
					// during preflight (input handlers, auth check, `before_agent_start`) is dropped.
					// Reissue it now that a run is active so the child actually stops.
					abortPromise = session?.abort().catch(() => {});
				}
				return;
			}
			if (!countsAgainstToolBudget(event)) {
				return;
			}
			toolCalls++;
			if (!budgetExceeded && isToolBudgetExceeded(toolCalls)) {
				budgetExceeded = true;
				abortPromise ??= session?.abort().catch(() => {}) ?? Promise.resolve();
			}
		});

		await session.prompt(params.prompt);
		return outcomeFromSession(session, { abortRequested, budgetExceeded });
	} catch (error) {
		if (session === undefined) {
			return {
				outcome: "error",
				text: "",
				errorMessage: errorMessage(error),
				sessionId: null,
				tokens: ZERO_TOKENS,
				cost: 0,
			};
		}
		if (budgetExceeded) {
			return outcomeFromSession(session, { abortRequested, budgetExceeded });
		}
		if (abortRequested) {
			return {
				outcome: "aborted",
				text: ABORTED_TEXT,
				sessionId: session.sessionId,
				...readUsage(session),
			};
		}
		return {
			outcome: "error",
			text: "",
			errorMessage: errorMessage(error),
			sessionId: session.sessionId,
			...readUsage(session),
		};
	} finally {
		unsubscribe?.();
		params.signal.removeEventListener("abort", onSignalAbort);
		if (abortPromise !== undefined) {
			await abortPromise;
		}
		try {
			session?.dispose();
		} catch {
			// Disposal must not overwrite a result that is already settled.
		}
	}
}

interface SessionFlags {
	abortRequested: boolean;
	budgetExceeded: boolean;
}

function outcomeFromSession(session: AgentSession, flags: SessionFlags): RlmRunResult {
	const usage = readUsage(session);
	if (flags.budgetExceeded) {
		return {
			outcome: "budget",
			text: budgetSummary(session.getLastAssistantText() ?? ""),
			sessionId: session.sessionId,
			...usage,
		};
	}
	if (flags.abortRequested) {
		return {
			outcome: "aborted",
			text: ABORTED_TEXT,
			sessionId: session.sessionId,
			...usage,
		};
	}
	const last = lastAssistantMessage(session);
	if (last?.stopReason === "error") {
		return {
			outcome: "error",
			text: "",
			errorMessage: last.errorMessage ?? "child session ended with an error",
			sessionId: session.sessionId,
			...usage,
		};
	}
	if (last?.stopReason === "aborted") {
		return {
			outcome: "error",
			text: "",
			errorMessage: "child session was aborted unexpectedly",
			sessionId: session.sessionId,
			...usage,
		};
	}
	return {
		outcome: "completed",
		text: session.getLastAssistantText() ?? "",
		sessionId: session.sessionId,
		...usage,
	};
}

function lastAssistantMessage(session: AgentSession): { stopReason?: string; errorMessage?: string } | undefined {
	return [...session.messages].reverse().find((message) => message.role === "assistant");
}

function readUsage(session: AgentSession): { tokens: RlmTokens; cost: number } {
	const stats: SessionStats = session.getSessionStats();
	return {
		tokens: {
			input: stats.tokens.input,
			output: stats.tokens.output,
			cacheRead: stats.tokens.cacheRead,
			cacheWrite: stats.tokens.cacheWrite,
			total: stats.tokens.total,
		},
		cost: stats.cost,
	};
}

function budgetSummary(partialText: string): string {
	const lines = [
		`ツール呼び出し回数の上限（${RLM_MAX_TOOL_CALLS}）を超えたため、子セッションを打ち切りました。`,
	];
	if (partialText !== "") {
		lines.push("--- 打ち切り時点の部分テキスト ---", partialText);
	}
	return lines.join("\n");
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
