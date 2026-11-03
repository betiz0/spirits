import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOverlayPackageJson, sha256Hex, verifyOverlayPackage, writeOverlayPackage } from "../src/managed-pi/overlay.ts";

const OFFICIAL = `${JSON.stringify(
	{
		name: "@earendil-works/pi-coding-agent",
		version: "1.5.0",
		type: "module",
		piConfig: { configDir: ".pi" },
		bin: { pi: "dist/bundle/cli.js" },
	},
	null,
	"\t",
)}\n`;

test("overlay preserves the official artifact name and version", () => {
	const overlay = createOverlayPackageJson(OFFICIAL);
	const parsed = JSON.parse(overlay.content);
	expect(parsed.name).toBe("@earendil-works/pi-coding-agent");
	expect(parsed.version).toBe("1.5.0");
});

test("overlay adds the spirits piConfig", () => {
	const overlay = createOverlayPackageJson(OFFICIAL);
	const parsed = JSON.parse(overlay.content);
	expect(parsed.piConfig).toEqual({ configDir: ".pi", name: "spirits" });
	expect(overlay.sha256).toBe(sha256Hex(overlay.content));
});

test("overlay checksum mismatch is rejected", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-overlay-"));
	try {
		await mkdir(join(dir, "pi"));
		await writeFile(join(dir, "pi", "package.json"), OFFICIAL);
		await expect(writeOverlayPackage(join(dir, "pi"), "0".repeat(64))).rejects.toThrow("Overlay checksum mismatch");
		const overlay = await writeOverlayPackage(join(dir, "pi"));
		await expect(verifyOverlayPackage(join(dir, "pi", "package.json"), overlay.sha256)).resolves.toBeUndefined();
		await expect(verifyOverlayPackage(join(dir, "pi", "package.json"), "0".repeat(64))).rejects.toThrow(
			"Overlay checksum mismatch",
		);
		expect(JSON.parse(await readFile(join(dir, "pi", "package.json"), "utf8")).piConfig.name).toBe("spirits");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
