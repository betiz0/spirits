/**
 * Compiled bundled-skill definition.
 *
 * The Markdown is a real file in this directory and is inlined as a string by Bun's
 * `with { type: "text" }` import (design Decision 2). `files[].path` is relative to
 * `<agentDir>/bundled-skills/<version>/<name>/`, matching the layout pi scans.
 */

import sprtArchitectureGuardsCheckGeneration from "./sprt-architecture-guards/references/check-generation.md" with {
	type: "text",
};
import sprtArchitectureGuardsConventionRegistry from "./sprt-architecture-guards/references/convention-registry.md" with {
	type: "text",
};
import sprtArchitectureGuardsPrinciples from "./sprt-architecture-guards/references/principles.md" with { type: "text" };
import sprtArchitectureGuardsSkill from "./sprt-architecture-guards/SKILL.md" with { type: "text" };
import sprtOpsxReviewChangeSkill from "./sprt-opsx-review-change/SKILL.md" with { type: "text" };
import sprtOpsxVerifyDeepSkill from "./sprt-opsx-verify-deep/SKILL.md" with { type: "text" };
import type { BundledSkill } from "./index.ts";

/** Bundled skills compiled into the binary. */
export function createBundledSkills(): BundledSkill[] {
	return [
		{
			name: "sprt-architecture-guards",
			files: [
				{ path: "SKILL.md", content: sprtArchitectureGuardsSkill },
				{ path: "references/check-generation.md", content: sprtArchitectureGuardsCheckGeneration },
				{ path: "references/convention-registry.md", content: sprtArchitectureGuardsConventionRegistry },
				{ path: "references/principles.md", content: sprtArchitectureGuardsPrinciples },
			],
		},
		{
			name: "sprt-opsx-review-change",
			files: [{ path: "SKILL.md", content: sprtOpsxReviewChangeSkill }],
		},
		{
			name: "sprt-opsx-verify-deep",
			files: [{ path: "SKILL.md", content: sprtOpsxVerifyDeepSkill }],
		},
	];
}
