import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadManagedArtifact, resolveManagedArtifactUrl } from "../src/managed-pi/artifact.ts";
import { sha256Hex } from "../src/managed-pi/overlay.ts";

const BODY = "managed artifact body";
const servers: Array<ReturnType<typeof Bun.serve>> = [];
const dirs: string[] = [];

afterAll(async () => {
	for (const server of servers) server.stop(true);
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

function startServer(status = 200): string {
	const server = Bun.serve({
		port: 0,
		fetch() {
			return status === 200 ? new Response(BODY) : new Response("missing", { status });
		},
	});
	servers.push(server);
	return `http://127.0.0.1:${server.port}`;
}

async function workDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "spirits-managed-artifact-"));
	dirs.push(dir);
	return dir;
}

test("artifact checksum matches", async () => {
	const dir = await workDir();
	const destination = join(dir, "artifact");
	await downloadManagedArtifact({
		fetch,
		artifact: { url: `${startServer()}/artifact`, sha256: sha256Hex(BODY) },
		destinationPath: destination,
		timeoutMs: 2000,
	});
	expect(await readFile(destination, "utf8")).toBe(BODY);
});

test("artifact checksum mismatch writes no file", async () => {
	const dir = await workDir();
	const destination = join(dir, "artifact");
	await expect(
		downloadManagedArtifact({
			fetch,
			artifact: { url: `${startServer()}/artifact`, sha256: "0".repeat(64) },
			destinationPath: destination,
			timeoutMs: 2000,
		}),
	).rejects.toThrow("Checksum mismatch");
	await expect(stat(destination)).rejects.toThrow();
});

test("artifact fetch failure is reported", async () => {
	const dir = await workDir();
	await expect(
		downloadManagedArtifact({
			fetch,
			artifact: { url: `${startServer(404)}/artifact`, sha256: sha256Hex(BODY) },
			destinationPath: join(dir, "artifact"),
			timeoutMs: 2000,
		}),
	).rejects.toThrow("HTTP 404");
});

test("relative artifact URLs resolve against the release base", () => {
	expect(resolveManagedArtifactUrl("ext.js", "https://example.test/release/")).toBe(
		"https://example.test/release/ext.js",
	);
	expect(resolveManagedArtifactUrl("/ext.js", "https://example.test/release/")).toBe(
		"https://example.test/ext.js",
	);
	expect(() => resolveManagedArtifactUrl("ext.js")).toThrow("relative");
});
