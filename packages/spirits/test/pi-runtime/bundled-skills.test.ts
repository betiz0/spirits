/**
 * Priority contract: pi's loader keeps the first skill with a given name, and the
 * default search paths come before extension-provided `skillPaths`. The bundled skill
 * tree is therefore always a follower, so a same-name user skill wins and produces a
 * collision diagnostic (design Decision 3).
 */

import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";

test("agent skills directory wins over same-name bundled skill", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "spirits-pi-bundled-skills-"));
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "project");
	const userPath = path.join(agentDir, "skills", "spike-skill", "SKILL.md");
	const bundledPath = path.join(root, "bundled-skills", "1.0.0", "spike-skill", "SKILL.md");
	await mkdir(path.dirname(userPath), { recursive: true });
	await writeFile(userPath, "---\nname: spike-skill\ndescription: user version\n---\n\nuser body\n");
	await mkdir(path.dirname(bundledPath), { recursive: true });
	await writeFile(bundledPath, "---\nname: spike-skill\ndescription: bundled version\n---\n\nbundled body\n");

	const result = loadSkills({
		cwd,
		agentDir,
		skillPaths: [path.dirname(bundledPath)],
		includeDefaults: true,
	});

	const skill = result.skills.find((candidate) => candidate.name === "spike-skill");
	expect(skill?.filePath).toBe(userPath);
	expect(skill?.description).toBe("user version");

	const collision = result.diagnostics.find(
		(diagnostic) => diagnostic.type === "collision" && diagnostic.collision?.name === "spike-skill",
	);
	expect(collision?.collision?.winnerPath).toBe(userPath);
	expect(collision?.collision?.loserPath).toBe(bundledPath);
});
