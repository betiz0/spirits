/**
 * Observations of the host surfaces spirits sits on, taken from the artifact a run launched.
 *
 * These three judgements replace the pin tests that reached into the host's sources or a non-public
 * subpath (remove-pi-fork §8.1):
 *
 * - the colours the startup art resolves to, read out of the theme JSON the artifact ships;
 * - the system prompt the host hands a provider after spirits' tool declarations go in;
 * - and, in `rlm.ts` next to the other child judgements, the model an rlm child inherits.
 *
 * Every judgement here is pure over an observation the process layer collected, so the rules are
 * testable without an artifact. Nothing in this module imports the host package or a spirits source
 * module: the colour tokens come from `header.ts` as text, because importing that module from a
 * script would give the run a route back to the fork's own `@earendil-works/*` sources.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { CompatState } from "./runner.ts";

/** The directory the official artifact ships its built-in themes in, inside the package dir. */
export const THEME_DIR_NAME = "theme";

/**
 * The colour tokens the startup art paints, in draw order, read out of `header.ts`.
 *
 * `ART_LINES` is the product's own list, and reading it from the source text keeps the observation
 * honest when a token is renamed: the observation then asks the artifact for the new name instead of
 * comparing the theme against a list that drifted.
 */
export function readArtColorTokens(headerSource: string): string[] {
	const block = /const ART_LINES\b[\s\S]*?\];/.exec(headerSource);
	if (block === null) return [];
	return [...block[0].matchAll(/color:\s*"([^"]+)"/g)].map((match) => match[1] ?? "");
}

/** One token's colour in one theme, before and after the `vars` indirection. */
export interface ThemeTokenColour {
	token: string;
	/** The value the theme's `colors` entry holds, which is a variable name or a colour. */
	raw?: string;
	/** The colour the token resolves to, following one `vars` hop. */
	resolved?: string;
}

/** One theme file found in the artifact, judged over the tokens spirits asks for. */
export interface ThemeObservation {
	name: string;
	path: string;
	colours: ThemeTokenColour[];
}

/** Resolve one `colors` entry the way the host does: a name in `vars` is not the colour itself. */
function resolveThemeColour(entry: unknown, vars: Record<string, unknown>): { raw?: string; resolved?: string } {
	if (typeof entry !== "string") return {};
	const viaVar = vars[entry];
	return { raw: entry, resolved: typeof viaVar === "string" ? viaVar : entry };
}

/**
 * Read every built-in theme the artifact ships and resolve `tokens` in each of them.
 *
 * A theme whose JSON cannot be read is reported with no colours, which the judgement below turns into
 * a failure rather than a silent skip: an artifact that ships an unreadable theme is not a host spirits
 * can paint on.
 */
export function observeThemeArtColours(packageDir: string, tokens: readonly string[]): ThemeObservation[] {
	const themeDir = join(packageDir, THEME_DIR_NAME);
	if (!existsSync(themeDir)) return [];
	const observations: ThemeObservation[] = [];
	for (const name of readdirSync(themeDir)
		.filter((file) => file.endsWith(".json"))
		.sort()) {
		const path = join(themeDir, name);
		let parsed: { vars?: unknown; colors?: unknown };
		try {
			parsed = JSON.parse(readFileSync(path, "utf8")) as { vars?: unknown; colors?: unknown };
		} catch {
			observations.push({ name: basename(name, ".json"), path, colours: tokens.map((token) => ({ token })) });
			continue;
		}
		const colors = (parsed.colors ?? {}) as Record<string, unknown>;
		const vars = (parsed.vars ?? {}) as Record<string, unknown>;
		observations.push({
			name: basename(name, ".json"),
			path,
			colours: tokens.map((token) => ({ token, ...resolveThemeColour(colors[token], vars) })),
		});
	}
	return observations;
}

/**
 * Decide whether the artifact's themes can paint the startup art.
 *
 * Two tokens resolving to the same colour is a failure, not a cosmetic difference: the art is four
 * lines whose shape is only readable while each line carries its own colour, and a token that looked
 * like a valid choice once occupied the same colour cell as another.
 */
export function classifyThemeArtColours(
	observations: readonly ThemeObservation[],
	tokens: readonly string[],
): { state: CompatState; detail: string } {
	if (tokens.length === 0) {
		return { state: "not-run", detail: "the header source named no colour tokens to look for" };
	}
	if (observations.length === 0) {
		return { state: "not-run", detail: `the launched host ships no theme file under ${THEME_DIR_NAME}/` };
	}
	const problems: string[] = [];
	const readings: string[] = [];
	for (const theme of observations) {
		const missing = theme.colours.filter((colour) => colour.resolved === undefined).map((colour) => colour.token);
		if (missing.length > 0) {
			problems.push(`${theme.name} has no colour for ${missing.join(", ")}`);
			continue;
		}
		const byColour = new Map<string, string[]>();
		for (const colour of theme.colours) {
			const key = (colour.resolved ?? "").replace(/\s+/g, "");
			byColour.set(key, [...(byColour.get(key) ?? []), colour.token]);
		}
		const collided = [...byColour.entries()].filter(([, names]) => names.length > 1);
		if (collided.length > 0) {
			problems.push(
				collided
					.map(([colour, names]) => `${theme.name} paints ${names.join(" and ")} the same (${colour})`)
					.join("; "),
			);
		}
		readings.push(`${theme.name}: ${theme.colours.map((colour) => `${colour.token}=${colour.resolved}`).join(" ")}`);
	}
	if (problems.length > 0) return { state: "failed", detail: problems.join("; ") };
	return {
		state: "confirmed",
		detail: `${observations.length} theme(s) give the ${tokens.length} art tokens distinct colours (${readings.join(" | ")})`,
	};
}

/** The roles a host may label its system prompt with inside a provider request. */
const SYSTEM_PROMPT_ROLES = ["developer", "system"];

/**
 * The system prompt a provider request carries.
 *
 * The official host sends it as a `developer` message, not a `system` one, so both names are read and
 * the parts of either shape (a bare string or `{ type: "text", text }` parts) are joined.
 */
export function extractSystemPrompt(body: unknown): string | undefined {
	const messages = (body as { messages?: unknown } | undefined)?.messages;
	if (!Array.isArray(messages)) return undefined;
	const parts: string[] = [];
	for (const message of messages) {
		const entry = message as { role?: unknown; content?: unknown };
		if (typeof entry.role !== "string" || !SYSTEM_PROMPT_ROLES.includes(entry.role)) continue;
		if (typeof entry.content === "string") {
			parts.push(entry.content);
			continue;
		}
		if (Array.isArray(entry.content)) {
			for (const part of entry.content) {
				const text = (part as { text?: unknown }).text;
				if (typeof text === "string") parts.push(text);
			}
		}
	}
	return parts.length === 0 ? undefined : parts.join("\n");
}

/** One tool's declaration, as the host reported it to another extension. */
export interface DeclaredToolPrompt {
	name: string;
	/** The guidelines the tool declared. The host puts each one into the rules section. */
	guidelines: readonly string[];
	/**
	 * The one-line entry the host puts in the tools section, when the host publishes it at all.
	 *
	 * The erased tool list of the official artifact carries `promptGuidelines` but no `promptSnippet`,
	 * so the snippet half of the judgement reads the entry back out of the prompt instead.
	 */
	snippet?: string;
}

export interface SystemPromptObservation {
	/** The prompt the provider received, or undefined when the run reached no provider request. */
	prompt?: string;
	/** The tools whose prompt declarations spirits owns. Each must reach the prompt. */
	spiritsTools: readonly string[];
	/** What the host reported for those tools. A tool missing here is a reported gap. */
	declared: readonly DeclaredToolPrompt[];
	/** Tools pi builds by itself, which must still be listed once spirits adds its own. */
	piTools: readonly string[];
	/** One rule pi writes by itself, so a rules section that only carries spirits' text is caught. */
	piRule: string;
	/** The marker of the section spirits adds. */
	sectionMarker: string;
	/** Why the prompt could not be read, when it could not. */
	reason?: string;
}

/** The tools-section line for one tool name. */
function toolEntryLine(tool: string): string {
	return `- ${tool}:`;
}

/** The tools-section line for one tool, with its text, read out of the prompt itself. */
export function toolEntryOf(prompt: string, tool: string): string | undefined {
	for (const line of prompt.split("\n")) {
		if (line.startsWith(toolEntryLine(tool))) return line.slice(toolEntryLine(tool).length).trim();
	}
	return undefined;
}

/**
 * Decide whether pi's own prompt survived what spirits adds, and whether what spirits adds arrived.
 *
 * This is the half the deleted pin test checked against pi's prompt builder in-process; the same two
 * directions are measured here on the running host, on the prompt the provider actually received.
 */
export function classifySystemPrompt(observation: SystemPromptObservation): {
	state: CompatState;
	detail: string;
	data: Record<string, unknown>;
} {
	const prompt = observation.prompt;
	if (prompt === undefined || prompt === "") {
		return {
			state: "not-run",
			detail: observation.reason ?? "no provider request carried a system prompt",
			data: {},
		};
	}
	const problems: string[] = [];
	if (!prompt.includes("<tools>")) problems.push("the prompt carries no tools section");
	if (!prompt.includes("<rules>")) problems.push("the prompt carries no rules section");
	const missingPiTools = observation.piTools.filter((tool) => !prompt.includes(toolEntryLine(tool)));
	if (missingPiTools.length > 0) problems.push(`pi's own tool list lost ${missingPiTools.join(", ")}`);
	const entries: Record<string, string | undefined> = {};
	for (const name of observation.spiritsTools) {
		const entry = toolEntryOf(prompt, name);
		entries[name] = entry;
		if (entry === undefined) {
			problems.push(`${name} is absent from the tools section`);
		} else if (entry === "") {
			problems.push(`${name} has an empty tools-section entry`);
		}
		const declaration = observation.declared.find((tool) => tool.name === name);
		if (declaration === undefined) {
			problems.push(`the host reported no prompt declaration for ${name}`);
			continue;
		}
		if (
			declaration.snippet !== undefined &&
			declaration.snippet !== "" &&
			entry !== undefined &&
			entry !== declaration.snippet
		) {
			problems.push(`the tools-section entry of ${name} is not the snippet it declared`);
		}
		for (const guideline of declaration.guidelines) {
			if (!prompt.includes(guideline)) problems.push(`${name}'s guideline never reached the prompt`);
		}
		if (declaration.guidelines.length === 0) problems.push(`${name} declared no guideline for the host to place`);
	}
	if (!prompt.includes(observation.piRule)) problems.push("pi's own rule is gone from the rules section");
	if (!prompt.includes(observation.sectionMarker)) problems.push("the spirits section never reached the prompt");
	const data = {
		length: prompt.length,
		sha256: new Bun.CryptoHasher("sha256").update(prompt).digest("hex"),
		toolsSectionEntries: (prompt.match(/^- [a-z0-9_]+:/gm) ?? []).map((line) => line.slice(2, -1)),
		spiritsToolEntries: entries,
		guidelines: observation.declared
			.filter((tool) => observation.spiritsTools.includes(tool.name))
			.map((tool) => ({ name: tool.name, count: tool.guidelines.length })),
	};
	if (problems.length > 0) return { state: "failed", detail: [...new Set(problems)].join("; "), data };
	return {
		state: "confirmed",
		detail: `pi's tools and rules survived, ${observation.spiritsTools.length} declared tool prompt(s) reached the prompt, and the spirits section is present (${prompt.length} characters)`,
		data,
	};
}
