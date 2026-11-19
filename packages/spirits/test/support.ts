import type { ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { SettingsPatch } from "../src/commands/settings-store.ts";
import type { CallableToolInfo, ExtensionModelRegistry, ReadonlySessionManager } from "../src/types/host.ts";
import { fakeModelRegistry, fakeProjection, fakeSessionManager, fakeToolCallOutcome, fakeToolContext, fakeUi } from "./host/fake-pi.ts";
import type { HostFnScope } from "../src/repl/registry.ts";
import type { ToolCallRecord } from "../src/repl/metrics.ts";

/** Apply the same shallow object merge the settings store uses, for in-memory command fixtures. */
export function mergeSettingsPatch(current: Record<string, unknown>, patch: SettingsPatch): Record<string, unknown> {
	const merged = { ...current };
	for (const [key, value] of Object.entries(patch)) {
		if (isPlainObject(value)) {
			const base = isPlainObject(current[key]) ? current[key] : {};
			merged[key] = { ...base, ...value };
		} else {
			merged[key] = value;
		}
	}
	return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const EMPTY_SESSION_MANAGER: ReadonlySessionManager = fakeSessionManager({
	getBranch: () => [],
	buildSessionProjection: () => fakeProjection(),
});

const EMPTY_MODEL_REGISTRY: ExtensionModelRegistry = fakeModelRegistry({
	getAvailable: () => [],
	find: () => undefined,
	hasConfiguredAuth: () => false,
});

/** Build an `ExtensionToolContext` good enough for REPL tests. */
export function makeToolContext(
	options: {
		cwd?: string;
		signal?: AbortSignal;
		model?: ExtensionToolContext["model"];
		thinkingLevel?: ExtensionToolContext["thinkingLevel"];
		executeTool?: ExtensionToolContext["executeTool"];
		tools?: readonly CallableToolInfo[];
		sessionManager?: object;
	} = {},
): ExtensionToolContext {
	return fakeToolContext({
		ui: fakeUi({
			setHeader: () => {},
			setWidget: () => {},
			setStatus: () => {},
			notify: () => {},
			// A tool context never opens a custom screen, so the one method a test could reach is a no-op
			// that resolves with nothing, which is what a closed screen reports.
			custom: <T,>(): Promise<T> => Promise.resolve(undefined as T),
		}),
		mode: "tui",
		cwd: options.cwd ?? process.cwd(),
		signal: options.signal,
		model: options.model,
		thinkingLevel: options.thinkingLevel,
		sessionManager: fakeSessionManager(options.sessionManager ?? EMPTY_SESSION_MANAGER),
		modelRegistry: EMPTY_MODEL_REGISTRY,
		tools: options.tools ?? [],
		executeTool: options.executeTool ?? (async () => fakeToolCallOutcome()),
	});
}

/**
 * One `registerShortcut()` registration, as the test fakes record it.
 *
 * The key id is the string the extension passed, so a test can look a shortcut up by the key the
 * settings resolved and then run the handler the way pi's input layer would.
 */
export interface RecordedShortcut {
	description?: string;
	handler: (ctx: ExtensionContext) => unknown;
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
