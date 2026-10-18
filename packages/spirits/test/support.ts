import type {
	CallableToolInfo,
	ExtensionModelRegistry,
	ExtensionToolContext,
	ReadonlySessionManager,
} from "@earendil-works/pi-coding-agent";
import type { HostFnScope } from "../src/repl/registry.ts";
import type { ToolCallRecord } from "../src/repl/metrics.ts";

const EMPTY_SESSION_MANAGER: ReadonlySessionManager = { getBranch: () => [] };

const EMPTY_MODEL_REGISTRY: ExtensionModelRegistry = {
	getAvailable: () => [],
	find: () => undefined,
	hasConfiguredAuth: () => false,
};

/** Build an `ExtensionToolContext` good enough for REPL tests. */
export function makeToolContext(
	options: {
		cwd?: string;
		signal?: AbortSignal;
		model?: ExtensionToolContext["model"];
		thinkingLevel?: ExtensionToolContext["thinkingLevel"];
		executeTool?: ExtensionToolContext["executeTool"];
		tools?: readonly CallableToolInfo[];
		sessionManager?: ReadonlySessionManager;
	} = {},
): ExtensionToolContext {
	return {
		ui: { setHeader: () => {}, setWidget: () => {}, notify: () => {} },
		mode: "tui",
		cwd: options.cwd ?? process.cwd(),
		signal: options.signal,
		model: options.model,
		thinkingLevel: options.thinkingLevel,
		sessionManager: options.sessionManager ?? EMPTY_SESSION_MANAGER,
		modelRegistry: EMPTY_MODEL_REGISTRY,
		tools: options.tools ?? [],
		executeTool:
			options.executeTool ??
			(async () => ({ toolCall: {}, result: { content: [], details: undefined }, isError: false })),
	};
}

export interface CapturedScope {
	scope: HostFnScope;
	printed: string[];
	state: { value: unknown };
	toolCalls: ToolCallRecord[];
}

/** Build a `HostFnScope` that records print/value writes. */
export function makeScope(
	options: {
		cwd?: string;
		signal?: AbortSignal;
		finished?: boolean;
		model?: ExtensionToolContext["model"];
		thinkingLevel?: ExtensionToolContext["thinkingLevel"];
		sessionManager?: ReadonlySessionManager;
	} = {},
): CapturedScope {
	const printed: string[] = [];
	const state: { value: unknown } = { value: undefined };
	const toolCalls: ToolCallRecord[] = [];
	const scope: HostFnScope = {
		signal: options.signal ?? new AbortController().signal,
		toolContext: makeToolContext({
			cwd: options.cwd,
			model: options.model,
			thinkingLevel: options.thinkingLevel,
			sessionManager: options.sessionManager,
		}),
		print: (text) => {
			if (!scope.finished) {
				printed.push(text);
			}
		},
		setValue: (value) => {
			if (!scope.finished) {
				state.value = value;
			}
		},
		recordToolCall: (record) => {
			toolCalls.push(record);
		},
		finished: options.finished ?? false,
	};
	return { scope, printed, state, toolCalls };
}
