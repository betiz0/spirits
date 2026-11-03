import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyBundledMarkdown, classifyWrittenMarkdown } from "../../../scripts/managed-pi-compat/probes.ts";

test("bundled SKILL.md is raw markdown", () => {
	expect(classifyBundledMarkdown("const skill = `---\nname: fixture\n---\n\n# body\n`;").state).toBe("confirmed");
	expect(classifyBundledMarkdown("&lt;h1&gt;not markdown&lt;/h1&gt;").state).toBe("failed");
});

test("written SKILL.md is read from disk", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-compat-asset-"));
	try {
		const path = join(dir, "SKILL.md");
		await writeFile(path, "---\nname: fixture\ndescription: test\n---\n\n# body\n");
		expect(classifyWrittenMarkdown(path)).toEqual({
			state: "confirmed",
			detail: "written SKILL.md is raw markdown",
		});
		await writeFile(path, "&lt;h1&gt;not markdown&lt;/h1&gt;");
		expect(classifyWrittenMarkdown(path).state).toBe("failed");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
