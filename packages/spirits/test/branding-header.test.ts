import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	type BrandingContext,
	type BrandingSettings,
	type HeaderComponent,
	type HeaderTheme,
	type HeaderThemeColor,
	SpiritsHeader,
	installBrandingHeader,
} from "../src/branding/header.ts";
import { resolveSpiritsVersion } from "../src/version.ts";

/** Deterministic theme stub for render assertions. */
const testTheme = { fg: (_color: string, text: string) => text };

/** The four startup art lines fixed by the `colorful-startup-mark` spec. */
const ART = [".--------.", "| Spirits \\__", "| __| --------", "| : ~~~~~"];

/** Theme stub recording the first `fg()` argument for every rendered text. */
function recordingTheme(): { theme: HeaderTheme; colorByText(): Map<string, string> } {
	const calls: Array<{ color: string; text: string }> = [];
	return {
		theme: {
			fg: (color, text) => {
				calls.push({ color, text });
				return text;
			},
		},
		colorByText: () => new Map(calls.map((call) => [call.text, call.color])),
	};
}

/** Theme stub that prefixes every text with the color the token resolves to. */
function paintedTheme(resolve: (color: HeaderThemeColor) => string): HeaderTheme {
	return { fg: (color, text) => `${resolve(color)} ${text}` };
}

/** Global theme slot pi's `keyHint`/`rawKeyHint` read. */
const THEME_SYMBOL = Symbol.for("@earendil-works/pi-coding-agent:theme");
const globalThemeSlots = globalThis as Record<symbol, unknown>;
let previousTheme: unknown;

beforeAll(() => {
	// The interactive mode initializes pi's global theme at startup; stub it so key hints render.
	previousTheme = globalThemeSlots[THEME_SYMBOL];
	globalThemeSlots[THEME_SYMBOL] = testTheme;
});

afterAll(() => {
	if (previousTheme === undefined) {
		delete globalThemeSlots[THEME_SYMBOL];
	} else {
		globalThemeSlots[THEME_SYMBOL] = previousTheme;
	}
});

function render(header: SpiritsHeader): string {
	return header.render(120).join("\n");
}

function asSpiritsHeader(component: HeaderComponent & { dispose?(): void }): SpiritsHeader {
	if (!(component instanceof SpiritsHeader)) {
		throw new Error("expected SpiritsHeader");
	}
	return component;
}

describe("SpiritsHeader", () => {
	test("shows the spirits wordmark and version without pi onboarding", () => {
		const lines = new SpiritsHeader(testTheme).render(120);
		const output = lines.join("\n");

		expect(output).toContain("spirits");
		expect(output).toContain(resolveSpiritsVersion());
		expect(output).not.toContain("Pi can explain");

		// product-identity order: art on top, then wordmark + version, key hints, onboarding.
		const lineOf = (needle: string) => lines.findIndex((line) => line.includes(needle));
		const art = lineOf(ART[0]);
		const wordmark = lineOf(resolveSpiritsVersion());
		const keyHints = lineOf("to show full startup help");
		const onboarding = lineOf("persistent TypeScript REPL");
		expect(art).toBe(0);
		expect(art).toBeLessThan(wordmark);
		expect(wordmark).toBeLessThan(keyHints);
		expect(keyHints).toBeLessThan(onboarding);
	});

	test("colors each art line with a distinct theme token", () => {
		const recorded = recordingTheme();

		new SpiritsHeader(recorded.theme).render(120);

		const colorByText = recorded.colorByText();
		const artColors = ART.map((line) => {
			const color = colorByText.get(line);
			if (!color) throw new Error(`no theme token recorded for art line: ${line}`);
			return color;
		});
		expect(new Set(artColors).size).toBe(4);
	});

	test("shows the art lines in collapsed and expanded help", () => {
		const header = new SpiritsHeader(testTheme);

		const collapsed = header.render(120);
		header.setExpanded(true);
		const expanded = header.render(120);

		for (const lines of [collapsed, expanded]) {
			expect(lines.slice(0, ART.length)).toEqual(ART);
		}
	});

	test("art colors follow the theme color resolution", () => {
		// Same art, but every token resolves to a different color.
		const remapped: Record<HeaderThemeColor, string> = { accent: "m", border: "a", dim: "u", muted: "d" };
		const before = new SpiritsHeader(paintedTheme((color) => `#${color}`)).render(120);
		const after = new SpiritsHeader(paintedTheme((color) => remapped[color])).render(120);

		const artBefore = before.slice(0, ART.length);
		const artAfter = after.slice(0, ART.length);

		expect(artAfter).not.toEqual(artBefore);
		expect(artAfter.map((line) => line.slice(2))).toEqual(ART);
	});

	test("setExpanded switches between compact and full startup help", () => {
		const header = new SpiritsHeader(testTheme);
		const collapsed = render(header);

		expect(collapsed).toContain("to show full startup help");

		header.setExpanded(true);
		const expanded = render(header);
		expect(expanded).not.toBe(collapsed);
		expect(expanded).toContain("to expand tools");

		header.setExpanded(false);
		expect(render(header)).toBe(collapsed);
	});
});

interface RecordedHeader {
	ctx: BrandingContext;
	installed(): SpiritsHeader | undefined;
	calls(): number;
}

function createContext(options: { mode?: string } = {}): RecordedHeader {
	let installed: SpiritsHeader | undefined;
	let calls = 0;
	const ctx: BrandingContext = {
		mode: options.mode ?? "tui",
		ui: {
			setHeader: (factory) => {
				calls += 1;
				installed = factory ? asSpiritsHeader(factory(undefined, testTheme)) : undefined;
			},
		},
	};
	return { ctx, installed: () => installed, calls: () => calls };
}

/** Settings provider returning a fixed `quietStartup` value. */
function settings(quietStartup?: boolean | "header"): () => BrandingSettings {
	return () => ({ quietStartup });
}

describe("installBrandingHeader", () => {
	test("installs the header in TUI mode", () => {
		const recorded = createContext();

		expect(installBrandingHeader(recorded.ctx, settings())).toBe(true);
		expect(recorded.calls()).toBe(1);
		const header = recorded.installed();
		expect(header).toBeDefined();
		expect(render(header as SpiritsHeader)).toContain("spirits");
	});

	test("keeps the installed header in sync with startup-help expansion", () => {
		const recorded = createContext();
		installBrandingHeader(recorded.ctx, settings());
		const installed = recorded.installed();
		if (!installed) throw new Error("expected an installed header");

		installed.setExpanded(true);

		expect(render(installed)).toContain("to expand tools");
	});

	test("does not install in non-TUI modes", () => {
		const recorded = createContext({ mode: "print" });

		expect(installBrandingHeader(recorded.ctx, settings())).toBe(false);
		expect(recorded.calls()).toBe(0);
	});

	test("does not install when quietStartup is true", () => {
		const recorded = createContext();

		expect(installBrandingHeader(recorded.ctx, settings(true))).toBe(false);
		expect(recorded.calls()).toBe(0);
	});

	test("installs when quietStartup is header or unset", () => {
		expect(installBrandingHeader(createContext().ctx, settings("header"))).toBe(true);
		expect(installBrandingHeader(createContext().ctx, settings())).toBe(true);
	});

	test("falls back to the built-in header when settings are unavailable", () => {
		const recorded = createContext();

		expect(
			installBrandingHeader(recorded.ctx, () => {
				throw new Error("settings unavailable");
			}),
		).toBe(false);
		expect(recorded.calls()).toBe(0);
	});
});
