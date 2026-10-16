/**
 * Loading and validation of the convention registry
 * (`docs/architecture/convention-registry.md`).
 *
 * The machine-readable parts are fenced code blocks whose info string is
 * `json registry:<name>` (design decision 12). Registry problems are not convention
 * violations, so they are reported without a rule ID and fail the whole check.
 */
import { readFileSync } from "node:fs";

export interface Violation {
	/** Convention ID for rule violations; undefined for structural failures. */
	ruleId?: string;
	message: string;
}

export interface RegistryData {
	/** Layer name -> allowed layer names (private packages, exception layers, spirits layers). */
	layers: Record<string, string[]>;
	/** Layer name -> member paths (private packages and spirits layers only). */
	layerMembers: Record<string, string[]>;
	/** Deep imports allowed in `packages/spirits/bin/`. */
	binDeepImports: string[];
	/** Permitted file-level cycles, each a set of repo-relative file paths. */
	cycles: string[][];
	/** Duplication ratchet baseline. */
	duplicationBaseline: number;
}

export interface RegistryLoad {
	data?: RegistryData;
	violations: Violation[];
}

export const REGISTRY_BLOCKS = [
	"layers",
	"layer-members",
	"bin-deep-imports",
	"cycles",
	"duplication",
] as const;

type RegistryBlockName = (typeof REGISTRY_BLOCKS)[number];

const CONVENTION_ITEMS = ["強度", "内容", "例外", "判定方法", "根拠"] as const;

interface ConventionSection {
	id: string;
	title: string;
	body: string;
}

function extractBlocks(markdown: string): Map<RegistryBlockName, string> {
	const blocks = new Map<RegistryBlockName, string>();
	const pattern = /```json registry:([\w-]+)\n([\s\S]*?)```/g;
	for (const match of markdown.matchAll(pattern)) {
		const name = match[1] as RegistryBlockName;
		if ((REGISTRY_BLOCKS as readonly string[]).includes(name)) {
			blocks.set(name, match[2]);
		}
	}
	return blocks;
}

function extractSections(markdown: string): ConventionSection[] {
	const sections: ConventionSection[] = [];
	const pattern = /^## ([A-Z][\w-]*): (.+)$/gm;
	const headings: { id: string; title: string; start: number; end: number }[] = [];
	for (const match of markdown.matchAll(pattern)) {
		headings.push({ id: match[1], title: match[2], start: match.index, end: match.index + match[0].length });
	}
	for (let i = 0; i < headings.length; i++) {
		const heading = headings[i];
		const next = headings[i + 1];
		const bodyStart = heading.end;
		const bodyEnd = next ? next.start : markdown.length;
		sections.push({ id: heading.id, title: heading.title, body: markdown.slice(bodyStart, bodyEnd) });
	}
	return sections;
}

/**
 * Check that every convention section for the reportable rule IDs carries the five
 * required items (strength, content, exceptions, method, rationale).
 */
export function validateConventionSections(markdown: string, requiredRuleIds: readonly string[]): Violation[] {
	const violations: Violation[] = [];
	const sections = extractSections(markdown);
	const byId = new Map(sections.map((section) => [section.id, section]));
	for (const id of requiredRuleIds) {
		const section = byId.get(id);
		if (!section) {
			violations.push({ message: `REGISTRY: convention section missing for rule id: ${id}` });
			continue;
		}
		for (const item of CONVENTION_ITEMS) {
			if (!section.body.includes(item)) {
				violations.push({ message: `REGISTRY: convention section ${id} is missing the item: ${item}` });
			}
		}
	}
	return violations;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Parse and structurally validate the registry document. Returns the parsed data, or
 * the structural violations when the document is missing a required block, is not
 * valid JSON, or has values of the wrong type.
 */
export function loadRegistry(registryPath: string, requiredRuleIds: readonly string[] = []): RegistryLoad {
	let markdown: string;
	try {
		markdown = readFileSync(registryPath, "utf8");
	} catch (error) {
		return { violations: [{ message: `REGISTRY: cannot read convention registry at ${registryPath}: ${(error as Error).message}` }] };
	}

	const violations = validateConventionSections(markdown, requiredRuleIds);
	const blocks = extractBlocks(markdown);
	for (const name of REGISTRY_BLOCKS) {
		if (!blocks.has(name)) {
			violations.push({ message: `REGISTRY: required block missing: registry:${name}` });
		}
	}
	if (violations.length > 0) return { violations };

	const parsed = new Map<RegistryBlockName, unknown>();
	for (const name of REGISTRY_BLOCKS) {
		const raw = blocks.get(name);
		if (raw === undefined) continue;
		try {
			parsed.set(name, JSON.parse(raw));
		} catch (error) {
			violations.push({ message: `REGISTRY: block registry:${name} is not valid JSON: ${(error as Error).message}` });
		}
	}
	if (violations.length > 0) return { violations };

	const layers = parsed.get("layers");
	const layerMembers = parsed.get("layer-members");
	const binDeepImports = parsed.get("bin-deep-imports");
	const cycles = parsed.get("cycles");
	const duplication = parsed.get("duplication");

	if (typeof layers !== "object" || layers === null || Array.isArray(layers)) {
		violations.push({ message: "REGISTRY: registry:layers must be an object" });
	} else {
		for (const [layer, allow] of Object.entries(layers as Record<string, unknown>)) {
			if (!isStringArray(allow)) {
				violations.push({ message: `REGISTRY: registry:layers value for ${layer} is not a string array` });
			}
		}
	}
	if (typeof layerMembers !== "object" || layerMembers === null || Array.isArray(layerMembers)) {
		violations.push({ message: "REGISTRY: registry:layer-members must be an object" });
	} else {
		for (const [layer, members] of Object.entries(layerMembers as Record<string, unknown>)) {
			if (!isStringArray(members)) {
				violations.push({ message: `REGISTRY: registry:layer-members value for ${layer} is not a string array` });
			}
		}
	}
	if (!isStringArray(binDeepImports)) {
		violations.push({ message: "REGISTRY: registry:bin-deep-imports is not a string array" });
	}
	if (!Array.isArray(cycles) || !cycles.every((cycle) => isStringArray(cycle))) {
		violations.push({ message: "REGISTRY: registry:cycles is not an array of string arrays" });
	}
	if (typeof duplication !== "object" || duplication === null || Array.isArray(duplication)) {
		violations.push({ message: "REGISTRY: registry:duplication must be an object" });
	} else {
		const baseline = (duplication as { baseline?: unknown }).baseline;
		if (typeof baseline !== "number" || !Number.isInteger(baseline) || baseline < 0) {
			violations.push({ message: "REGISTRY: registry:duplication baseline is not a non-negative integer" });
		}
	}
	if (violations.length > 0) return { violations };

	return {
		data: {
			layers: layers as Record<string, string[]>,
			layerMembers: layerMembers as Record<string, string[]>,
			binDeepImports: binDeepImports as string[],
			cycles: cycles as string[][],
			duplicationBaseline: (duplication as { baseline: number }).baseline,
		},
		violations: [],
	};
}
