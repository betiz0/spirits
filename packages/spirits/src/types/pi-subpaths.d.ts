/**
 * Ambient declarations for pi subpath imports used by `bin/`.
 *
 * Runtime resolution goes through `bin/tsconfig.json` (which extends the root tsconfig and its
 * `paths` to pi source). The package `exports` do not expose these subpaths, so the type checker
 * needs these declarations to avoid loading pi source into the program (see M1 rationale in
 * `pi-coding-agent.d.ts`).
 */

declare module "@earendil-works/pi-coding-agent/bun/runtime-setup";
declare module "@earendil-works/pi-coding-agent/bun/sandbox-env-setup";

declare module "@earendil-works/pi-coding-agent/cli/setup" {
	export function setupCli(): void;
}

/**
 * The `/model` argument split interactive mode performs. Only the pin test
 * `test/pi-runtime/model-roles-api.test.ts` reads it, to check a trailing role word against the
 * vocabulary an extension registered with pi.
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
}
