import { expect, test } from "bun:test";
import path from "node:path";
import { ENV_AGENT_DIR } from "../src/constants.ts";
import {
	getAgentDir,
	memoryDir,
	notesPath,
	promptBackupPath,
	promptOverridePath,
	skillsDir,
} from "../src/harness/paths.ts";

const AGENT_DIR = "/tmp/spirits-agent-paths-test";

function withAgentDir(dir: string, run: () => void): void {
	const previous = process.env[ENV_AGENT_DIR];
	process.env[ENV_AGENT_DIR] = dir;
	try {
		run();
	} finally {
		if (previous === undefined) {
			delete process.env[ENV_AGENT_DIR];
		} else {
			process.env[ENV_AGENT_DIR] = previous;
		}
	}
}

test("paths follow PI_CODING_AGENT_DIR", () => {
	withAgentDir(AGENT_DIR, () => {
		expect(getAgentDir()).toBe(AGENT_DIR);
		expect(memoryDir(getAgentDir())).toBe(path.join(AGENT_DIR, "memory"));
		expect(notesPath(AGENT_DIR)).toBe(path.join(AGENT_DIR, "memory", "notes.md"));
		expect(skillsDir(AGENT_DIR)).toBe(path.join(AGENT_DIR, "skills"));
	});
});

test("override lives in prompts subdir", () => {
	expect(promptOverridePath(AGENT_DIR)).toBe(
		path.join(AGENT_DIR, "prompts", "spirits", "code-mode.md"),
	);
	expect(promptBackupPath(AGENT_DIR)).toBe(
		path.join(AGENT_DIR, "prompts", "spirits", "code-mode.md.bak"),
	);
});
