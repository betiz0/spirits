/**
 * Shared types for the self-update modules.
 *
 * Kept dependency-free so the update path only uses the fixed values it owns.
 */

/** Environment shape accepted by the update modules. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/** Fetch shape used by the update modules. Tests inject fixture implementations. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
