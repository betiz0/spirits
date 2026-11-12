/**
 * Minimal local mirror of the `@earendil-works/pi-tui` surface that the TODO widget uses.
 *
 * The real types live in `packages/tui/src`. Spirits does not compile against them
 * directly: the `paths` entry in `packages/spirits/tsconfig.json` points type-only
 * imports at this file, which the runtime does not load. Runtime resolution of
 * `@earendil-works/pi-tui` inside `src/todo/` goes through `src/todo/tsconfig.json`,
 * which extends the repo root config and its `paths` to the tui source.
 */

/** Truncate text to fit within a maximum visible width, adding ellipsis if needed. */
export function truncateToWidth(text: string, maxWidth: number, ellipsis?: string, pad?: boolean): string;

/**
 * Identifier of a keyboard shortcut, spelled like `ctrl+shift+l`.
 *
 * Upstream this is a template-literal union of pi's base keys and their modifier combinations, built
 * from a key list pi keeps in types only. The mirror widens it to `string` because the only value
 * spirits sends is a toggle key read from settings: `resolveTodoConfig` checks it against the same
 * modifier-then-base-key grammar before `registerShortcut` receives it, and a spirits-side copy of
 * the key list would drift from upstream.
 */
export type KeyId = string;
