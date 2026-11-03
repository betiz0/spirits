import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRead, classifyWrite, readAgentDirSnapshot } from "../../../scripts/managed-pi-compat/data.ts";

const dirs: string[] = [];
afterAll(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "spirits-compat-data-"));
	dirs.push(root);
	const agent = join(root, "agent");
	await mkdir(join(agent, "sessions"), { recursive: true });
	await mkdir(join(agent, "extensions"), { recursive: true });
	await writeFile(join(agent, "settings.json"), JSON.stringify({ defaultProvider: "fake" }));
	await writeFile(join(agent, "auth.json"), JSON.stringify({ fake: { key: "redacted" } }));
	await writeFile(join(agent, "sessions", "s1.jsonl"), "{}\n");
	await writeFile(join(agent, "extensions", "ext.ts"), "export default function () {}\n");
	return agent;
}

test("reads settings and sessions from a redacted copy", async () => {
	const agent = await fixture();
	const snapshot = readAgentDirSnapshot(agent);
	expect(snapshot.settings).toBe(true);
	expect(snapshot.auth).toBe(true);
	expect(snapshot.sessions).toEqual(["s1.jsonl"]);
	expect(snapshot.extensions).toEqual(["ext.ts"]);
	expect(classifyRead(snapshot).state).toBe("confirmed");
});

test("never writes the real agent dir", async () => {
	const agent = await fixture();
	const before = await readFile(join(agent, "settings.json"), "utf8");
	readAgentDirSnapshot(agent);
	expect(await readFile(join(agent, "settings.json"), "utf8")).toBe(before);
});

test("write compatibility is not confirmed by read success", async () => {
	const snapshot = readAgentDirSnapshot(await fixture());
	expect(classifyRead(snapshot).state).toBe("confirmed");
	expect(classifyWrite({ requiresConversion: false }).state).toBe("not-run");
});

test("conversion-requiring write is aborted", () => {
	const result = classifyWrite({ requiresConversion: true });
	expect(result.state).toBe("limited");
	expect(result.detail).toContain("aborted");
});
