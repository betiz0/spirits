/**
 * Pins the built-in theme half of `colorful-startup-mark`: the four ASCII art lines of the startup
 * header resolve to distinct colors in the built-in themes, in both color modes.
 *
 * Distinct token names are not the requirement; distinct resolved colors are. The token
 * `borderAccent` once looked like a valid fourth choice while occupying the same 256-color cell as
 * `accent`, and an imperceptible RGB difference in truecolor, which painted two art lines the same
 * color. If this test fails, a token swap or a theme edit made two art lines read as one color.
 */

import { expect, test } from "bun:test";
import {
	loadThemeFromPath,
	type TerminalColorMode,
} from "@earendil-works/pi-coding-agent/modes/interactive/theme/theme";
import { join } from "node:path";
import { ART_LINES } from "../../src/branding/header.ts";

/** Built-in theme JSONs shipped with pi. */
const THEME_DIR = join(import.meta.dir, "..", "..", "..", "coding-agent", "src", "modes", "interactive", "theme");

const BUILT_IN_THEMES = ["dark", "light"] as const;
const COLOR_MODES: readonly TerminalColorMode[] = ["truecolor", "256color"];

test("art tokens resolve to distinct colors in built-in themes", () => {
	expect(ART_LINES).toHaveLength(4);

	for (const themeName of BUILT_IN_THEMES) {
		for (const mode of COLOR_MODES) {
			const theme = loadThemeFromPath(join(THEME_DIR, `${themeName}.json`), mode);
			const colors = ART_LINES.map((line) => theme.fg(line.color, ""));

			expect(new Set(colors).size, `${themeName}/${mode} -> ${colors.join(" ")}`).toBe(ART_LINES.length);
		}
	}
});
