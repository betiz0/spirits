/**
 * pi's default prompt around the pieces spirits adds.
 *
 * Spirits adds two things to the system prompt: the `spirits` section (the code-mode prompt, pinned
 * in `test/harness-install.test.ts`) and, through the tsrepl declaration, one tool-list entry and
 * two guideline bullets. Neither may push out what pi builds by itself.
 *
 * The snippet and the guidelines are read off the registered tool declaration, so a rename or a
 * dropped declaration breaks this test rather than only the model's view. pi's session start then
 * feeds those same declarations into the builder (`AgentSession._rebuildSystemPrompt`).
 *
 * This runs against pi's real prompt builder, which is why it lives in `pi-runtime/`: pi does not
 * export it from the package root.
 */

import { expect, test } from "bun:test";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { buildSystemPrompt } from "@earendil-works/pi-coding-agent/core/system-prompt";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promptOverridePath } from "../../src/harness/paths.ts";
import { resolveCodeModePrompt } from "../../src/harness/prompt.ts";
import { createTsreplTool, TSREPL_PROMPT_GUIDELINES, TSREPL_PROMPT_SNIPPET } from "../../src/tools.ts";

// spec "continual-harness / 既存プロンプトの維持": bash と tsrepl が並び、既定の規則が残る
test("system prompt keeps default tools and rules", async () => {
	const agentDir = await mkdtemp(path.join(tmpdir(), "spirits-sysprompt-"));
	try {
		const override = promptOverridePath(agentDir);
		await mkdir(path.dirname(override), { recursive: true });
		await writeFile(override, "spirits code-mode\nspirits section marker");

		const tsrepl = createTsreplTool();
		const bash = createBashTool(process.cwd());
		const prompt = buildSystemPrompt({
			cwd: process.cwd(),
			// A session with bash and tsrepl active: pi lists the declared tools by snippet and adds
			// their guidelines to the rules.
			selectedTools: ["bash", "tsrepl"],
			toolSnippets: { bash: bash.promptSnippet ?? "", tsrepl: tsrepl.promptSnippet ?? "" },
			toolGuidelines: { bash: bash.promptGuidelines ?? [], tsrepl: tsrepl.promptGuidelines ?? [] },
			sections: { spirits: await resolveCodeModePrompt(agentDir) },
		});

		// pi's tool list section keeps bash and carries the tsrepl entry from its own declaration.
		expect(prompt).toContain("<tools>");
		expect(prompt).toContain("- bash:");
		expect(prompt).toContain(`- tsrepl: ${TSREPL_PROMPT_SNIPPET}`);

		// pi's rules section keeps its own bash rule and carries the tsrepl guidelines.
		expect(prompt).toContain("<rules>");
		expect(prompt).toContain("Use bash for file operations like ls, rg, find");
		for (const guideline of TSREPL_PROMPT_GUIDELINES) {
			expect(prompt).toContain(guideline);
		}
		expect(prompt).toContain("spirits section marker");
	} finally {
		await rm(agentDir, { recursive: true, force: true });
	}
});
