/**
 * Version and flag handling for the compiled entry.
 *
 * Split out of `bootstrap.ts` so the logic can be unit-tested without executing `run()` on
 * import.
 */

/** Version reported by `spirits --version` for uncompiled runs. */
const UNCOMPILED_SPIRITS_VERSION = "0.0.0-dev";

/** Flags that print the spirits version instead of starting pi. */
export const VERSION_FLAGS = new Set(["--version", "-v"]);

/**
 * Injected at build time by `scripts/build-binaries.ts` via `Bun.build` `define`.
 *
 * Uncompiled runs have no such binding; `typeof` keeps the reference safe.
 */
declare const SPIRITS_VERSION: string | undefined;

/** True when running as a build-time compiled binary. */
export function isCompiledRun(): boolean {
	return typeof SPIRITS_VERSION !== "undefined";
}

/** Version embedded at build time, or the development fallback when uncompiled. */
export function resolveSpiritsVersion(): string {
	if (typeof SPIRITS_VERSION === "undefined") {
		return UNCOMPILED_SPIRITS_VERSION;
	}
	return SPIRITS_VERSION;
}

/** Line printed for `--version` / `-v`. */
export function formatVersionLine(spiritsVersion: string, bunVersion: string): string {
	return `spirits ${spiritsVersion} (Bun ${bunVersion})`;
}
