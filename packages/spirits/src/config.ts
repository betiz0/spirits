/**
 * Layer 3 configuration: values the operator can change per environment.
 *
 * The memory limits are read once at extension load. Invalid values fall back to the
 * Layer 2 defaults instead of failing startup (design Decision 11).
 */

import {
	DEFAULT_MEMORY_FILE_LINE_LIMIT,
	DEFAULT_MEMORY_INJECTION_CHAR_LIMIT,
	DEFAULT_MEMORY_PREVIEW_LINES,
	ENV_MEMORY_CHAR_LIMIT,
	ENV_MEMORY_LINE_LIMIT,
	ENV_MEMORY_PREVIEW_LINES,
} from "./constants.ts";

/** Resolved memory limits. Unit: lines, JS string length, lines. */
export interface MemoryLimits {
	/** Excerpt lines per file. */
	previewLines: number;
	/** Character cap for the whole `spirits_memory` section. */
	injectionCharLimit: number;
	/** Line count above which a file is listed as a cleanup candidate. */
	fileLineLimit: number;
}

/** Resolved configuration for the continual harness. */
export interface SpiritsConfig {
	memory: MemoryLimits;
}

/** Positive decimal integers only: rejects empty, signs, decimals, and leading zeros. */
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;

/** Environment shape accepted by `loadConfig`. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

function readLimit(env: EnvLike, name: string, fallback: number): number {
	const raw = env[name];
	if (raw === undefined || !POSITIVE_INTEGER_PATTERN.test(raw)) {
		return fallback;
	}
	const value = Number(raw);
	if (!Number.isSafeInteger(value)) {
		return fallback;
	}
	return value;
}

/** Resolve the harness configuration, falling back to defaults for absent or invalid values. */
export function loadConfig(env: EnvLike): SpiritsConfig {
	return {
		memory: {
			previewLines: readLimit(env, ENV_MEMORY_PREVIEW_LINES, DEFAULT_MEMORY_PREVIEW_LINES),
			injectionCharLimit: readLimit(env, ENV_MEMORY_CHAR_LIMIT, DEFAULT_MEMORY_INJECTION_CHAR_LIMIT),
			fileLineLimit: readLimit(env, ENV_MEMORY_LINE_LIMIT, DEFAULT_MEMORY_FILE_LINE_LIMIT),
		},
	};
}
