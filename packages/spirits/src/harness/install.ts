/**
 * Wiring for the continual harness.
 *
 * `registerContinualHarness` resolves the configuration once, registers the four codemode
 * tools, subscribes to `before_agent_start` to fill the `spirits` / `spirits_memory` prompt
 * sections, and returns the `goal` / `note` host functions for the root `tsrepl`.
 *
 * The handler only adds its own sections: other sections and `forceSystemPrompt` are left
 * untouched so pi's default prompt survives. Memory read failures inside
 * `buildMemorySummary` skip the file instead of failing the agent start.
 */

import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../config.ts";
import type { HostFnEntry } from "../repl/registry.ts";
import { createGoalHostFn } from "./goal.ts";
import { buildMemorySummary, createNoteHostFn } from "./memory.ts";
import { resolveCodeModePrompt } from "./prompt.ts";
import { createHarnessTools } from "./tools.ts";

/** System prompt section carrying the code-mode prompt. */
const SECTION_SPIRITS = "spirits";

/** System prompt section carrying the memory summary. */
const SECTION_MEMORY = "spirits_memory";

export interface ContinualHarnessOptions {
	agentDir: string;
	/** Environment snapshot resolved once at registration. Defaults to `process.env`. */
	env?: Readonly<Record<string, string | undefined>>;
}

/** Register the continual harness and return `[goal, note]` for the root tsrepl. */
export function registerContinualHarness(
	pi: ExtensionAPI,
	options: ContinualHarnessOptions,
): HostFnEntry[] {
	const config = loadConfig(options.env ?? process.env);
	// Resolve before any module builds paths: a relative PI_CODING_AGENT_DIR still
	// yields absolute heading paths, note return values, and entry `file` fields.
	const agentDir = path.resolve(options.agentDir);

	for (const tool of createHarnessTools(agentDir)) {
		pi.registerTool(tool);
	}

	const goal = createGoalHostFn({ pi });
	const note = createNoteHostFn({ pi, agentDir });

	pi.on("before_agent_start", async (event) => {
		event.systemPromptOptions.sections[SECTION_SPIRITS] = await resolveCodeModePrompt(agentDir);
		const summary = await buildMemorySummary(agentDir, config.memory);
		if (summary !== undefined) {
			event.systemPromptOptions.sections[SECTION_MEMORY] = summary;
		}
	});

	return [goal, note];
}
