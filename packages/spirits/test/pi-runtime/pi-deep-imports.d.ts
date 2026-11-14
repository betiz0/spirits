/**
 * Ambient declarations for pi subpath imports used by the pin tests in this directory.
 *
 * The launcher no longer imports the host at all, so these declarations live beside the tests that
 * read them instead of in `src/types/`. They exist because pi does not export these subpaths and the
 * package isolation in `packages/spirits/tsconfig.json` keeps pi sources out of the program.
 *
 * Each declaration has exactly one reader among the pin tests here. Remove this file together with
 * the last test that reads it (`remove-pi-fork` tasks 8.1 and 8.2).
 */

declare module "@earendil-works/pi-coding-agent/modes/interactive/model-command-args" {
	export interface ModelCommandArgs {
		searchTerm?: string;
		thinkingLevel?: string;
		role?: string;
	}
	export function parseModelCommandArgs(args: string, roles?: readonly string[]): ModelCommandArgs;
}

/**
 * pi's theme loader and the color-mode union. Only the pin test
 * `test/pi-runtime/branding-art-colors.test.ts` reads them, to check that the art lines of the
 * startup header resolve to distinct colors in the built-in themes.
 */
declare module "@earendil-works/pi-coding-agent/modes/interactive/theme/theme" {
	/** pi's terminal color modes. */
	export type TerminalColorMode = "256color" | "truecolor";
	/** The subset of pi's `Theme` the pin test reads. */
	export interface Theme {
		fg(color: string, text: string): string;
	}
	/** Load a theme JSON file, overriding the terminal color mode. */
	export function loadThemeFromPath(themePath: string, mode?: TerminalColorMode): Theme;
}

/**
 * pi's system prompt builder. Only `test/pi-runtime/system-prompt-defaults.test.ts` calls it, to check
 * that a session with bash and tsrepl active still lists both tools and keeps pi's own rules next to
 * the ones spirits contributes. pi does not export this from the package root.
 */
declare module "@earendil-works/pi-coding-agent/core/system-prompt" {
	/** The subset of pi's `BuildSystemPromptOptions` the test passes. */
	export interface SystemPromptBuildOptions {
		cwd: string;
		selectedTools?: string[];
		toolSnippets?: Record<string, string>;
		toolGuidelines?: Record<string, string[]>;
		sections?: Record<string, string>;
	}
	/** The rendered prompt, with every non-preamble section wrapped in its tag. */
	export function buildSystemPrompt(input: SystemPromptBuildOptions): string;
}

/**
 * pi's routing record of a virtual model. Only the pin test
 * `test/pi-runtime/routing-record-pin.test.ts` reads it, to check that the record spirits writes under
 * its mirrored entry type is the one pi reads back for the badge role and the router state.
 */
declare module "@earendil-works/pi-coding-agent/core/virtual-models" {
	/** pi's custom entry type of the routing record. */
	export const VIRTUAL_MODEL_STATE_ENTRY: string;
	/** Data of a routing record. `role` is absent on a record written before roles existed. */
	export interface VirtualModelStateData {
		provider: string;
		modelId: string;
		state?: unknown;
		role?: string;
	}
	/** The latest routing record of the given virtual model on a session branch. */
	export function getVirtualModelEntry(
		branch: readonly unknown[],
		provider: string,
		modelId: string,
	): VirtualModelStateData | undefined;
	/**
	 * The latest successful response: the last assistant message whose stop reason is neither `error`
	 * nor `aborted`. pi derives a route request's `previous` from it, so the pin test
	 * `test/pi-runtime/child-model-source-pin.test.ts` compares spirits' own branch scan against it.
	 */
	export function findLatestResponse(
		messages: readonly unknown[],
	): { provider: string; model: string; stopReason?: string } | undefined;
}
