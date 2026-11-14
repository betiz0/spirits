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
 * The render contract pi-tui components satisfy, mirrored from `packages/tui/src/tui.ts`. The role
 * panel returns pi-tui's own components, so this is only what a caller passes them through.
 */
export interface Component {
	render(width: number): string[];
	invalidate(): void;
	handleInput?(data: string): void;
	wantsKeyRelease?: boolean;
}

/** One row of a {@link SettingsList}. Only `id`, `label`, and `currentValue` are always required. */
export interface SettingItem {
	id: string;
	label: string;
	/** Shown under the list while the row is selected. */
	description?: string;
	/** Right-hand value shown for the row. */
	currentValue: string;
	/** Enter/Space cycles through these values. Ignored when `submenu` is present. */
	values?: string[];
	/** Enter opens this submenu instead of cycling. */
	submenu?: (
		currentValue: string,
		done: (selectedValue?: string, options?: { navigateTo?: string }) => void,
	) => Component;
}

/**
 * Row colors of a {@link SettingsList}. Every field is read during `render`, so a row set built without
 * one of them throws inside the extension rather than showing a partial list.
 */
export interface SettingsListTheme {
	label: (text: string, selected: boolean) => string;
	value: (text: string, selected: boolean) => string;
	description: (text: string) => string;
	cursor: string;
	hint: (text: string) => string;
}

/** One row of a {@link SelectList}. */
export interface SelectItem {
	value: string;
	label: string;
	description?: string;
}

/** Colors and notices of a {@link SelectList}. Every field is read during `render`. */
export interface SelectListTheme {
	selectedPrefix: (text: string) => string;
	selectedText: (text: string) => string;
	description: (text: string) => string;
	scrollInfo: (text: string) => string;
	noMatch: (text: string) => string;
}

/**
 * pi-tui's settings list: rows of `label` + `currentValue`, a description under the selected row, and
 * Enter either cycling `values` or opening `submenu`.
 *
 * The mirror carries only the surface the role panel uses. `onChange` fires with the row id and the new
 * value; `updateValue` redraws one row without rebuilding the list.
 */
export class SettingsList {
	constructor(
		items: SettingItem[],
		maxVisible: number,
		theme: SettingsListTheme,
		onChange: (id: string, newValue: string) => void,
		onCancel: () => void,
		options?: { enableSearch?: boolean },
	);
	updateValue(id: string, newValue: string): void;
	selectItem(id: string): void;
	render(width: number): string[];
	invalidate(): void;
	handleInput?(data: string): void;
}

/**
 * pi-tui's select list: one highlighted row per choice, `onSelect` on Enter, `onCancel` on Escape.
 * `setFilter` keeps the candidates whose `value` starts with the filter.
 */
export class SelectList {
	constructor(items: SelectItem[], maxVisible: number, theme: SelectListTheme);
	setFilter(filter: string): void;
	setSelectedIndex(index: number): void;
	render(width: number): string[];
	invalidate(): void;
	handleInput?(data: string): void;
	onSelect?: (item: SelectItem) => void;
	onCancel?: () => void;
	onSelectionChange?: (item: SelectItem) => void;
}

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

/**
 * Identifier of one of pi-tui's configurable gestures, spelled like `tui.select.cancel`.
 *
 * Upstream this is a union of the action names in `TUI_KEYBINDINGS`. The mirror widens it to `string`
 * for the same reason {@link KeyId} is widened: the value spirits sends is a name it reads from that
 * table, and a spirits-side copy of the table would drift from upstream.
 */
export type Keybinding = string;

/** pi-tui's keybinding manager: which gesture a key press matches, from the user's configuration. */
export interface KeybindingsManager {
	matches(data: string, keybinding: Keybinding): boolean;
}

/**
 * The keybinding manager pi-tui's own components consult.
 *
 * A screen that needs to recognise a gesture goes through this rather than comparing bytes, so the
 * gesture stays the one the user configured and survives a rebind.
 */
export function getKeybindings(): KeybindingsManager;
