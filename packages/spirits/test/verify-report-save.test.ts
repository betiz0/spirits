/**
 * Numbering, exclusive whole-file creation, and the wired saver.
 *
 * The numbering is max-plus-one and never repairs a gap; the creation never replaces an existing
 * name and never leaves a partial file at the final name; the saver adds the empty-body refusal and
 * resolves the directory first, so a resolution failure writes nothing (spec
 * `verification-report-saving`).
 */

import { expect, test } from "bun:test";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERIFY_REPORT_EMPTY_BODY_REASON } from "../src/constants.ts";
import { createReportFile, nextReportNumber, reportSeriesPattern } from "../src/verify/report-name.ts";
import { createReportSaver } from "../src/verify/save.ts";

async function tempDir(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "spirits-verify-save-"));
}

test("the series pattern takes exactly <prefix><n>.md", () => {
	const pattern = reportSeriesPattern("verify");
	expect(pattern.test("verify1.md")).toBe(true);
	expect(pattern.test("verify42.md")).toBe(true);
	expect(pattern.test("d-verify1.md")).toBe(false);
	expect(pattern.test("verify-notes.md")).toBe(false);
	expect(pattern.test("verify1.md.bak")).toBe(false);
	expect(pattern.test("verify.md")).toBe(false);
	expect(pattern.test(".spirits-verify-report-x.tmp")).toBe(false);
});

test("numbering: empty directory, max plus one, gaps left alone, series kept apart", async () => {
	const dir = await tempDir();
	try {
		expect(await nextReportNumber(dir, "verify")).toBe(1);
		await writeFile(join(dir, "verify1.md"), "a");
		await writeFile(join(dir, "verify2.md"), "b");
		expect(await nextReportNumber(dir, "verify")).toBe(3);

		// A gap stays a gap: the numbering counts verifications, not free slots.
		const gapped = await tempDir();
		await writeFile(join(gapped, "verify1.md"), "a");
		await writeFile(join(gapped, "verify3.md"), "c");
		expect(await nextReportNumber(gapped, "d-verify")).toBe(1);
		expect(await nextReportNumber(gapped, "verify")).toBe(4);

		// Files outside the series do not count.
		await writeFile(join(gapped, "verify-notes.md"), "notes");
		await writeFile(join(gapped, "verify1.md.bak"), "bak");
		await writeFile(join(gapped, ".spirits-verify-report-x.tmp"), "tmp");
		expect(await nextReportNumber(gapped, "verify")).toBe(4);
		await rm(gapped, { recursive: true, force: true });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a successful create holds the body whole at the new name", async () => {
	const dir = await tempDir();
	try {
		await writeFile(join(dir, "verify1.md"), "existing");
		const result = await createReportFile(dir, "verify", "# Report\nfinal body");
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.path).toBe(join(dir, "verify2.md"));
		expect(await Bun.file(result.path).text()).toBe("# Report\nfinal body");
		// The existing file is untouched, and no temporary file is left behind.
		expect(await Bun.file(join(dir, "verify1.md")).text()).toBe("existing");
		expect((await readdir(dir)).sort()).toEqual(["verify1.md", "verify2.md"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a name taken after the numbering re-numbers and leaves the first file alone", async () => {
	const dir = await tempDir();
	try {
		// The collision is injected between the numbering and the link — the window the retry
		// exists for — not by pre-placing the final name, which the numbering would just see.
		// One-shot, standing for the one other run that races this one.
		let injected = false;
		const result = await createReportFile(dir, "verify", "mine", {
			beforeLink: (finalPath) => {
				if (injected) return undefined;
				injected = true;
				return writeFile(finalPath, "theirs");
			},
		});
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.path).toBe(join(dir, "verify2.md"));
		expect(await Bun.file(join(dir, "verify1.md")).text()).toBe("theirs");
		expect(await Bun.file(join(dir, "verify2.md")).text()).toBe("mine");
		expect((await readdir(dir)).sort()).toEqual(["verify1.md", "verify2.md"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a directory that cannot be written leaves neither a final file nor a temporary one", async () => {
	const dir = await tempDir();
	try {
		// A read-only directory makes even the temporary creation fail; nothing may survive.
		await chmod(dir, 0o500);
		const result = await createReportFile(dir, "verify", "body");
		await chmod(dir, 0o700);
		expect(result.kind).toBe("error");
		if (result.kind === "error") expect(result.reason).toContain("could not write the report");
		expect((await readdir(dir)).sort()).toEqual([]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

// d-verify3 C-2: the directory vanishing between the resolution and the numbering is a save
// failure with a reason, not an exception reaching the tool.
test("a directory gone before the numbering is a reason, not an exception", async () => {
	const dir = await tempDir();
	await rm(dir, { recursive: true, force: true });
	const result = await createReportFile(dir, "verify", "body");
	expect(result.kind).toBe("error");
	if (result.kind === "error") expect(result.reason).toContain("could not read");
});

// d-verify3 C-2: a body write that fails **after** the temporary file exists must still clean the
// temporary file up. The seam stands for the failure production cannot reproduce on demand.
test("a write that fails after the temporary file exists removes the temporary file", async () => {
	const dir = await tempDir();
	try {
		const result = await createReportFile(dir, "verify", "body", {
			writeTemp: async (tempPath) => {
				// Stands for a partial write: the name exists, the body did not make it.
				await writeFile(tempPath, "partial", { flag: "wx" });
				throw new Error("ENOSPC: no space left on device");
			},
		});
		expect(result.kind).toBe("error");
		if (result.kind === "error") expect(result.reason).toContain("could not write the report");
		expect((await readdir(dir)).sort()).toEqual([]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the number limit is a refusal with a reason, not a wrap or an overwrite", async () => {
	const dir = await tempDir();
	try {
		await writeFile(join(dir, "verify999.md"), "full");
		const result = await createReportFile(dir, "verify", "body");
		expect(result.kind).toBe("error");
		if (result.kind === "error") expect(result.reason).toContain("999");
		expect(await Bun.file(join(dir, "verify999.md")).text()).toBe("full");
		expect((await readdir(dir)).sort()).toEqual(["verify999.md"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the saver resolves first: an unresolvable change writes nothing", async () => {
	const dir = await tempDir();
	try {
		const saver = createReportSaver({
			resolveChangeRoot: async (name) =>
				name === "known" ? { kind: "ok", changeRoot: dir } : { kind: "error", reason: `no change ${name}` },
		});
		const failure = await saver("body", "unknown", "verify");
		expect(failure.kind).toBe("error");
		expect((await readdir(dir)).sort()).toEqual([]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("the saver refuses an empty body before touching the disk", async () => {
	const dir = await tempDir();
	try {
		let resolved = false;
		const saver = createReportSaver({
			resolveChangeRoot: async () => {
				resolved = true;
				return { kind: "ok", changeRoot: dir };
			},
		});
		const blank = await saver("   \n ", "known", "verify");
		expect(blank).toEqual({ kind: "error", reason: VERIFY_REPORT_EMPTY_BODY_REASON });
		expect(resolved).toBe(false);
		expect((await readdir(dir)).sort()).toEqual([]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

// d-verify3 C-2 at the saver's own boundary: an I/O failure after the resolution is a reason.
test("the saver turns a post-resolution I/O failure into a reason", async () => {
	const saver = createReportSaver({
		resolveChangeRoot: async () => ({ kind: "ok", changeRoot: join(tmpdir(), "spirits-verify-save-absent") }),
	});
	const result = await saver("body", "known", "verify");
	expect(result.kind).toBe("error");
	if (result.kind === "error") expect(result.reason).toContain("could not read");
});

test("two saves of the same change are two files under the resolved directory", async () => {
	const dir = await tempDir();
	try {
		const saver = createReportSaver({ resolveChangeRoot: async () => ({ kind: "ok", changeRoot: dir }) });
		const first = await saver("one", "known", "verify");
		const second = await saver("two", "known", "verify");
		expect(first.kind === "ok" && first.path).toBe(join(dir, "verify1.md"));
		expect(second.kind === "ok" && second.path).toBe(join(dir, "verify2.md"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
