/**
 * Compiled bundled-skill definition.
 *
 * The Markdown is a real file in this directory and is inlined as a string by Bun's
 * `with { type: "text" }` import (design Decision 2). `files[].path` is relative to
 * `<agentDir>/bundled-skills/<version>/<name>/`, matching the layout pi scans.
 */

import architectureGuardsCheckGeneration from "./architecture-guards/references/check-generation.md" with {
	type: "text",
};
import architectureGuardsConventionRegistry from "./architecture-guards/references/convention-registry.md" with {
	type: "text",
};
import architectureGuardsPrinciples from "./architecture-guards/references/principles.md" with { type: "text" };
import architectureGuardsSkill from "./architecture-guards/SKILL.md" with { type: "text" };
import type { BundledSkill } from "./index.ts";

/** Bundled skills compiled into the binary. */
export function createBundledSkills(): BundledSkill[] {
	return [
		{
			name: "architecture-guards",
			files: [
				{ path: "SKILL.md", content: architectureGuardsSkill },
				{ path: "references/check-generation.md", content: architectureGuardsCheckGeneration },
				{ path: "references/convention-registry.md", content: architectureGuardsConventionRegistry },
				{ path: "references/principles.md", content: architectureGuardsPrinciples },
			],
		},
	];
}
