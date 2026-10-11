/**
 * spirits startup header for interactive mode.
 *
 * `installBrandingHeader` replaces pi's built-in header through `ctx.ui.setHeader`, showing the
 * spirits wordmark, embedded version, key hints, and onboarding text. It only runs in TUI mode
 * and leaves sessions with `quietStartup: true` on pi's built-in (empty) header. Colors use
 * theme tokens so the header follows the user's theme.
 */

import { keyHint, keyText, rawKeyHint } from "@earendil-works/pi-coding-agent";
import { resolveSpiritsVersion } from "../version.ts";

/** Theme colors the header uses. */
export type HeaderThemeColor = "accent" | "dim" | "muted";

/** Theme façade the header reads. */
export interface HeaderTheme {
	fg(color: HeaderThemeColor, text: string): string;
}

/** Component contract the pi TUI calls for custom headers. */
export interface HeaderComponent {
	render(width: number): string[];
	invalidate(): void;
}

/** Header factory accepted by `ctx.ui.setHeader`. */
export type HeaderFactory = (tui: unknown, theme: HeaderTheme) => HeaderComponent & { dispose?(): void };

/** Context the install function needs from pi. */
export interface BrandingContext {
	/** Current run mode; the header is TUI-only. */
	mode: string;
	ui: { setHeader(factory: HeaderFactory | undefined): void };
}

/** Settings subset the install check reads. */
export interface BrandingSettings {
	quietStartup?: boolean | "header";
}

/** Full startup hints, one per line. */
function expandedHints(): string[] {
	return [
		keyHint("app.interrupt", "to interrupt"),
		keyHint("app.clear", "to clear"),
		rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
		keyHint("app.exit", "to exit (empty)"),
		keyHint("app.suspend", "to suspend"),
		keyHint("tui.editor.deleteToLineEnd", "to delete to end"),
		keyHint("app.thinking.cycle", "to cycle thinking level"),
		rawKeyHint(`${keyText("app.model.cycleForward")}/${keyText("app.model.cycleBackward")}`, "to cycle models"),
		keyHint("app.model.select", "to select model"),
		keyHint("app.tools.expand", "to expand tools"),
		keyHint("app.thinking.toggle", "to expand thinking"),
		keyHint("app.editor.external", "for external editor"),
		rawKeyHint("/", "for commands"),
		rawKeyHint("!", "to run bash"),
		rawKeyHint("!!", "to run bash (no context)"),
		keyHint("app.message.followUp", "to queue follow-up"),
		keyHint("app.message.dequeue", "to edit all queued messages"),
		keyHint("app.clipboard.pasteImage", "to paste files on macOS, images, or text"),
		rawKeyHint("drop files", "to attach"),
	];
}

/** Compact hint line shown while startup help is collapsed. */
function compactHints(): string {
	return [
		keyHint("app.interrupt", "interrupt"),
		rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
		rawKeyHint("/", "commands"),
		rawKeyHint("!", "bash"),
		keyHint("app.tools.expand", "more"),
	].join(" · ");
}

/** One-line description of what spirits offers. */
const ONBOARDING =
	"spirits is a persistent TypeScript REPL agent; ask it to run code with tsrepl, delegate with rlm, or take notes with note().";

/** Header component shown at startup. `setExpanded` mirrors pi's startup-help expansion. */
export class SpiritsHeader implements HeaderComponent {
	private readonly theme: HeaderTheme;
	private expanded: boolean;

	constructor(theme: HeaderTheme, expanded = false) {
		this.theme = theme;
		this.expanded = expanded;
	}

	/** Sync with pi's startup-help expansion state. */
	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	invalidate(): void {}

	render(_width: number): string[] {
		const wordmark = `${this.theme.fg("accent", "spirits")} ${this.theme.fg("dim", `v${resolveSpiritsVersion()}`)}`;
		const onboarding = this.theme.fg("dim", ONBOARDING);
		if (this.expanded) {
			return [wordmark, ...expandedHints(), "", onboarding];
		}
		const collapsed = this.theme.fg("dim", `Press ${keyText("app.tools.expand")} to show full startup help.`);
		return [wordmark, compactHints(), collapsed, "", onboarding];
	}
}

/**
 * Install the spirits header when running in TUI mode and the user did not request a quiet
 * startup. Returns true when the header was installed. A failing `getSettings` falls back to the
 * built-in header instead of hiding startup output.
 */
/**
 * Install the spirits header when running in TUI mode and the user did not request a quiet
 * startup. `getSettings` is resolved lazily: a throw falls back to the built-in header instead
 * of hiding startup output.
 */
export function installBrandingHeader(ctx: BrandingContext, getSettings: () => BrandingSettings): boolean {
	if (ctx.mode !== "tui") {
		return false;
	}
	let quietStartup: boolean | "header" | undefined;
	try {
		quietStartup = getSettings().quietStartup;
	} catch {
		return false;
	}
	if (quietStartup === true) {
		return false;
	}
	ctx.ui.setHeader((_tui, theme) => new SpiritsHeader(theme));
	return true;
}
