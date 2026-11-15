/**
 * The judgements of the three host-surface observations that replaced the deep pin tests (§8.1).
 *
 * The process layer that fills these in needs the launched artifact, so what is under test here is
 * the rule: what a theme file has to show, what a prompt has to carry, and which reading of either is
 * a gap rather than a verdict.
 */

import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	classifySystemPrompt,
	classifyThemeArtColours,
	extractSystemPrompt,
	observeThemeArtColours,
	readArtColorTokens,
	toolEntryOf,
	type SystemPromptObservation,
	type ThemeObservation,
} from "../../../scripts/managed-pi-compat/host-surfaces.ts";

/** The header source the product ships, trimmed to the list the observation reads. */
const HEADER_SOURCE = `
export const ART_LINES: ReadonlyArray<{ readonly text: string; readonly color: HeaderThemeColor }> = [
	{ text: ".--------.", color: "border" },
	{ text: "| Spirits \\\\__", color: "accent" },
	{ text: "| __| --------", color: "dim" },
	{ text: "| : ~~~~~", color: "muted" },
];

export const OTHER: string[] = ["color: \\"not-an-art-token\\""];
`;

/** One theme, as a theme file would carry the four art tokens. */
function theme(name: string, colors: Record<string, string>, vars: Record<string, string> = {}): ThemeObservation {
	const tokens = readArtColorTokens(HEADER_SOURCE);
	return {
		name,
		path: `/artifact/theme/${name}.json`,
		colours: tokens.map((token) => {
			const raw = colors[token];
			if (raw === undefined) return { token };
			return { token, raw, resolved: vars[raw] ?? raw };
		}),
	};
}

test("art colour tokens come from the header's own list", () => {
	expect(readArtColorTokens(HEADER_SOURCE)).toEqual(["border", "accent", "dim", "muted"]);
	// A header with no art list leaves the observation with nothing to ask the artifact for, which the
	// judgement reports as a gap instead of a pass over an empty set.
	expect(readArtColorTokens("export const THING = 1;")).toEqual([]);
});

test("theme colours resolve through the vars indirection", async () => {
	const packageDir = await mkdtemp(join(tmpdir(), "spirits-theme-"));
	try {
		await mkdir(join(packageDir, "theme"), { recursive: true });
		await writeFile(
			join(packageDir, "theme", "dark.json"),
			JSON.stringify({ vars: { violet: "okhsl(295 50% 67%)", muted: "okhsl(229 6% 67%)" }, colors: { border: "okhsl(231 57% 65%)", accent: "violet", dim: "okhsl(229 8% 56%)", muted: "muted" } }),
		);
		const themes = observeThemeArtColours(packageDir, readArtColorTokens(HEADER_SOURCE));
		expect(themes.map((theme) => theme.name)).toEqual(["dark"]);
		const accent = themes[0]?.colours.find((colour) => colour.token === "accent");
		expect(accent?.raw).toBe("violet");
		expect(accent?.resolved).toBe("okhsl(295 50% 67%)");
		expect(classifyThemeArtColours(themes, readArtColorTokens(HEADER_SOURCE)).state).toBe("confirmed");
	} finally {
		await rm(packageDir, { recursive: true, force: true });
	}
});

test("an artifact with no theme files is a gap, not a pass", () => {
	const judgement = classifyThemeArtColours([], ["border", "accent", "dim", "muted"]);
	expect(judgement.state).toBe("not-run");
	expect(judgement.detail).toContain("no theme file");
	// The same for a header that named no tokens: nothing was asked, so nothing was measured.
	expect(classifyThemeArtColours([], []).state).toBe("not-run");
});

test("a missing token or a shared colour fails", () => {
	const good = { border: "okhsl(1 1% 1%)", accent: "okhsl(2 2% 2%)", dim: "okhsl(3 3% 3%)", muted: "okhsl(4 4% 4%)" };
	expect(classifyThemeArtColours([theme("dark", good)], readArtColorTokens(HEADER_SOURCE)).state).toBe("confirmed");

	const withoutDim = { ...good };
	delete (withoutDim as Record<string, string>).dim;
	const missing = classifyThemeArtColours([theme("dark", withoutDim)], readArtColorTokens(HEADER_SOURCE));
	expect(missing.state).toBe("failed");
	expect(missing.detail).toContain("no colour for dim");

	// Two tokens on the same colour is the failure the pin existed for: the art stops reading as four
	// lines, and a token can look like a valid choice while it occupies another token's colour.
	const collided = classifyThemeArtColours([theme("dark", { ...good, muted: good.border })], readArtColorTokens(HEADER_SOURCE));
	expect(collided.state).toBe("failed");
	expect(collided.detail).toContain("paints border and muted the same");

	// The indirection hides it: a var name that resolves onto another token's colour is the same failure.
	const viaVar = classifyThemeArtColours(
		[theme("light", { border: "okhsl(9 9% 9%)", accent: "shared", dim: "okhsl(7 7% 7%)", muted: "other" }, { shared: "okhsl(9 9% 9%)", other: "okhsl(8 8% 8%)" })],
		readArtColorTokens(HEADER_SOURCE),
	);
	expect(viaVar.state).toBe("failed");
	expect(viaVar.detail).toContain("paints border and accent the same");
});

/** A prompt that carries pi's defaults, two spirits tools, and the spirits section. */
function promptWith(overrides: { withoutRule?: boolean; withoutGuideline?: string; withoutTool?: string; withoutSection?: boolean } = {}): string {
	const guidelines = ["tsrepl rule one", "tsrepl rule two", "todos rule one"];
	const lines = [
		"<tools>",
		"- read: Read file contents",
		"- bash: Execute a bash command",
		...(overrides.withoutTool === "tsrepl" ? [] : ["- tsrepl: 永続 TypeScript REPL のセルを実行する。"]),
		...(overrides.withoutTool === "manage_todos" ? [] : ["- manage_todos: セッション TODO を一括で追加・更新・削除します"]),
		"</tools>",
		"<rules>",
		overrides.withoutRule === true ? "- some other rule" : "- Use bash for file operations like ls, rg, find",
		...(guidelines.filter((line) => line !== overrides.withoutGuideline).map((line) => `  - ${line}`)),
		"</rules>",
		...(overrides.withoutSection === true ? [] : ["## spirits code-mode", "cell rules"]),
	];
	return lines.join("\n");
}

/** The observation of that prompt, with the declared guidelines the host reported. */
function promptObservation(prompt: string | undefined, overrides: Partial<SystemPromptObservation> = {}): SystemPromptObservation {
	return {
		prompt,
		spiritsTools: ["tsrepl", "manage_todos"],
		declared: [
			{ name: "tsrepl", guidelines: ["tsrepl rule one", "tsrepl rule two"] },
			{ name: "manage_todos", guidelines: ["todos rule one"] },
		],
		piTools: ["bash", "read"],
		piRule: "Use bash for file operations like ls, rg, find",
		sectionMarker: "## spirits code-mode",
		...overrides,
	};
}

test("the system prompt carries pi's defaults and what spirits declares", () => {
	const judgement = classifySystemPrompt(promptObservation(promptWith()));
	expect(judgement.state).toBe("confirmed");
	// The digest and length ride along, so a run can be compared with the recorded measurement.
	const data = judgement.data as { sha256: string; length: number; toolsSectionEntries: string[] };
	expect(data.sha256).toMatch(/^[0-9a-f]{64}$/);
	expect(data.length).toBe(promptWith().length);
	expect(data.toolsSectionEntries).toEqual(["read", "bash", "tsrepl", "manage_todos"]);
});

test("every lost piece of the prompt fails with the reason named", () => {
	const cases: Array<[Parameters<typeof promptWith>[0], string]> = [
		[{ withoutRule: true }, "pi's own rule is gone"],
		[{ withoutGuideline: "tsrepl rule two" }, "tsrepl's guideline never reached the prompt"],
		[{ withoutTool: "tsrepl" }, "tsrepl is absent from the tools section"],
		[{ withoutTool: "manage_todos" }, "manage_todos is absent from the tools section"],
		[{ withoutSection: true }, "the spirits section never reached the prompt"],
	];
	for (const [override, expected] of cases) {
		const judgement = classifySystemPrompt(promptObservation(promptWith(override)));
		expect(judgement.state, JSON.stringify(override)).toBe("failed");
		expect(judgement.detail, JSON.stringify(override)).toContain(expected);
	}
});

test("a prompt the run never reached is a gap", () => {
	const judgement = classifySystemPrompt(promptObservation(undefined, { reason: "the fake provider recorded no request" }));
	expect(judgement.state).toBe("not-run");
	expect(judgement.detail).toContain("recorded no request");
	// A tool the host reported nothing for is a failed observation, not a silent skip.
	const silent = classifySystemPrompt(promptObservation(promptWith(), { declared: [] }));
	expect(silent.state).toBe("failed");
	expect(silent.detail).toContain("no prompt declaration for tsrepl");
});

test("the prompt is read from the role the host labels it with", () => {
	expect(extractSystemPrompt({ messages: [{ role: "developer", content: "the prompt" }] })).toBe("the prompt");
	expect(extractSystemPrompt({ messages: [{ role: "system", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] })).toBe("a\nb");
	expect(extractSystemPrompt({ messages: [{ role: "user", content: "only the user speaks" }] })).toBeUndefined();
	expect(extractSystemPrompt(undefined)).toBeUndefined();
	expect(toolEntryOf("- bash: run it", "bash")).toBe("run it");
	expect(toolEntryOf("- bash:", "bash")).toBe("");
	expect(toolEntryOf("- other: x", "bash")).toBeUndefined();
});
