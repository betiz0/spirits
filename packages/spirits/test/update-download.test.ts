import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadVerifiedBinary, parseChecksumFile } from "../src/update/download.ts";

const BINARY_CONTENT = "fake spirits binary";
const ARTIFACT_NAME = "spirits-linux-x64";

const runningServers: Array<ReturnType<typeof Bun.serve>> = [];
const workDirs: string[] = [];

afterAll(async () => {
	for (const server of runningServers) {
		server.stop(true);
	}
	for (const dir of workDirs) {
		await rm(dir, { recursive: true, force: true });
	}
});

function sha256Hex(content: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(content);
	return hasher.digest("hex");
}

function startArtifactServer(checksumContent: string): { baseUrl: string; requests: string[] } {
	const requests: string[] = [];
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			requests.push(path);
			if (path === `/${ARTIFACT_NAME}.sha256`) {
				return new Response(checksumContent);
			}
			if (path === `/${ARTIFACT_NAME}`) {
				return new Response(BINARY_CONTENT);
			}
			return new Response("not found", { status: 404 });
		},
	});
	runningServers.push(server);
	return { baseUrl: `http://127.0.0.1:${server.port}`, requests };
}

async function makeWorkDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "spirits-update-download-"));
	workDirs.push(dir);
	return dir;
}

test("downloads and verifies a matching artifact", async () => {
	const fixture = startArtifactServer(`${sha256Hex(BINARY_CONTENT)}  ${ARTIFACT_NAME}\n`);
	const work = await makeWorkDir();
	const destination = join(work, ARTIFACT_NAME);
	await downloadVerifiedBinary({
		fetch,
		binaryUrl: `${fixture.baseUrl}/${ARTIFACT_NAME}`,
		checksumUrl: `${fixture.baseUrl}/${ARTIFACT_NAME}.sha256`,
		destinationPath: destination,
		timeoutMs: 2000,
	});
	expect(await readFile(destination, "utf8")).toBe(BINARY_CONTENT);
	expect(fixture.requests).toEqual([`/${ARTIFACT_NAME}.sha256`, `/${ARTIFACT_NAME}`]);
});

test("removes the partial file when the checksum does not match", async () => {
	const fixture = startArtifactServer(`${"0".repeat(64)}  ${ARTIFACT_NAME}\n`);
	const work = await makeWorkDir();
	const destination = join(work, ARTIFACT_NAME);
	await expect(
		downloadVerifiedBinary({
			fetch,
			binaryUrl: `${fixture.baseUrl}/${ARTIFACT_NAME}`,
			checksumUrl: `${fixture.baseUrl}/${ARTIFACT_NAME}.sha256`,
			destinationPath: destination,
			timeoutMs: 2000,
		}),
	).rejects.toThrow("Checksum mismatch");
	await expect(stat(destination)).rejects.toThrow();
});

test("rejects a malformed checksum file without downloading the artifact", async () => {
	const fixture = startArtifactServer("not a checksum\n");
	const work = await makeWorkDir();
	const destination = join(work, ARTIFACT_NAME);
	await expect(
		downloadVerifiedBinary({
			fetch,
			binaryUrl: `${fixture.baseUrl}/${ARTIFACT_NAME}`,
			checksumUrl: `${fixture.baseUrl}/${ARTIFACT_NAME}.sha256`,
			destinationPath: destination,
			timeoutMs: 2000,
		}),
	).rejects.toThrow("SHA256");
	expect(fixture.requests).toEqual([`/${ARTIFACT_NAME}.sha256`]);
	await expect(stat(destination)).rejects.toThrow();
});

test("parses sha256sum-style checksum files", () => {
	const hash = "a".repeat(64);
	expect(parseChecksumFile(`${hash}  ${ARTIFACT_NAME}\n`)).toBe(hash);
	expect(parseChecksumFile(`${hash.toUpperCase()}  ${ARTIFACT_NAME}\n`)).toBe(hash);
	expect(parseChecksumFile("")).toBeUndefined();
	expect(parseChecksumFile("missing-digest\n")).toBeUndefined();
});

test("keeps an existing destination when the checksum is invalid", async () => {
	const fixture = startArtifactServer("garbage\n");
	const work = await makeWorkDir();
	const destination = join(work, ARTIFACT_NAME);
	await writeFile(destination, "original");
	await expect(
		downloadVerifiedBinary({
			fetch,
			binaryUrl: `${fixture.baseUrl}/${ARTIFACT_NAME}`,
			checksumUrl: `${fixture.baseUrl}/${ARTIFACT_NAME}.sha256`,
			destinationPath: destination,
			timeoutMs: 2000,
		}),
	).rejects.toThrow();
	expect(await readFile(destination, "utf8")).toBe("original");
});
