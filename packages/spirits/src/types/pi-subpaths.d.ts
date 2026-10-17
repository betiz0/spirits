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
