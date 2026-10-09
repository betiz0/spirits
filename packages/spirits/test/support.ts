import type { ExtensionToolContext, ReadonlySessionManager } from "@earendil-works/pi-coding-agent";
import type { HostFnScope } from "../src/repl/registry.ts";

const EMPTY_SESSION_MANAGER: ReadonlySessionManager = { getBranch: () => [] };

/** Build an `ExtensionToolContext` good enough for REPL tests. */
export function makeToolContext(
	options: {
		cwd?: string;
		signal?: AbortSignal;
		model?: ExtensionToolContext["model"];
		thinkingLevel?: ExtensionToolContext["thinkingLevel"];
		executeTool?: ExtensionToolContext["executeTool"];
		sessionManager?: ReadonlySessionManager;
	} = {},
): ExtensionToolContext {
	return {
		cwd: options.cwd ?? process.cwd(),
		signal: options.signal,
		model: options.model,
		thinkingLevel: options.thinkingLevel,
		sessionManager: options.sessionManager ?? EMPTY_SESSION_MANAGER,
		tools: [],
		executeTool:
			options.executeTool ??
			(async () => ({ toolCall: {}, result: { content: [], details: undefined }, isError: false })),
	};
}

export interface CapturedScope {
	scope: HostFnScope;
	printed: string[];
	state: { value: unknown };
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
		finished: options.finished ?? false,
	};
	return { scope, printed, state };
}
