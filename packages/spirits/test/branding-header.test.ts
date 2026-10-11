import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	type BrandingContext,
	type BrandingSettings,
	type HeaderComponent,
	SpiritsHeader,
	installBrandingHeader,
} from "../src/branding/header.ts";
import { resolveSpiritsVersion } from "../src/version.ts";

/** Deterministic theme stub for render assertions. */
const testTheme = { fg: (_color: string, text: string) => text };

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
		const output = render(new SpiritsHeader(testTheme));

		expect(output).toContain("spirits");
		expect(output).toContain(resolveSpiritsVersion());
		expect(output).not.toContain("Pi can explain");
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
