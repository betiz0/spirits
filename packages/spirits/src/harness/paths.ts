/**
 * Agent-directory layout for the continual harness.
 *
 * This is the only harness module that imports pi values (`getAgentDir`). The nested
 * `tsconfig.json` makes Bun resolve that import through the root `paths` at runtime
 * (same scheme as `src/rlm/`); the package type check resolves it through the local
 * type mirror.
 */

import path from "node:path";
import { getAgentDir as piGetAgentDir } from "@earendil-works/pi-coding-agent";
import { MEMORY_NOTES_FILE_NAME } from "../constants.ts";

/** Directory that holds the memory Markdown files. */
const MEMORY_DIR_NAME = "memory";

/** Directory that holds one subdirectory per skill. */
const SKILLS_DIR_NAME = "skills";

/** Directory pi scans for user prompt templates (non-recursive). */
const PROMPTS_DIR_NAME = "prompts";

/** Subdirectory that keeps the override out of pi's prompt-template scan. */
const PROMPTS_NAMESPACE = "spirits";

/** Override file name for the code-mode system prompt. */
const CODE_MODE_FILE_NAME = "code-mode.md";

/** Suffix of the single pre-change backup. */
const BACKUP_SUFFIX = ".bak";

/** Resolve pi's agent directory (honors `PI_CODING_AGENT_DIR`). */
export { piGetAgentDir as getAgentDir };

/** `<agentDir>/memory/`. */
export function memoryDir(agentDir: string): string {
	return path.join(agentDir, MEMORY_DIR_NAME);
}

/** `<agentDir>/memory/notes.md`. */
export function notesPath(agentDir: string): string {
	return path.join(memoryDir(agentDir), MEMORY_NOTES_FILE_NAME);
}

/** `<agentDir>/skills/`. */
export function skillsDir(agentDir: string): string {
	return path.join(agentDir, SKILLS_DIR_NAME);
}

/** `<agentDir>/prompts/spirits/code-mode.md`. */
export function promptOverridePath(agentDir: string): string {
	return path.join(agentDir, PROMPTS_DIR_NAME, PROMPTS_NAMESPACE, CODE_MODE_FILE_NAME);
}

/** `<agentDir>/prompts/spirits/code-mode.md.bak`. */
export function promptBackupPath(agentDir: string): string {
	return `${promptOverridePath(agentDir)}${BACKUP_SUFFIX}`;
}
