/**
 * The save tool's contract: body in, nothing else; the execution-time guard refuses before any
 * write when no verifying step is open or nothing is pinned (spec `verification-report-saving` /
 * 検証が有効でない保存要求は書き込み前に拒否する).
 */

import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	TOOL_NAME_VERIFY_REPORT_SAVE,
	VERIFY_REPORT_EMPTY_BODY_REASON,
	VERIFY_REPORT_NOT_VERIFYING_REASON,
	VERIFY_REPORT_UNPINNED_REASON,
} from "../src/constants.ts";
import { createReportSaver } from "../src/verify/save.ts";
import { createVerifyReportSaveTool } from "../src/verify/tool.ts";
import { erasedToolContext } from "./host/fake-pi.ts";

interface Harness {
	tool: ReturnType<typeof createVerifyReportSaveTool>;
	saveCalls: Array<{ changeName: string; prefix: string; storeId: string | undefined }>;
	savedCount(): number;
}

function harness(options: { prefix?: string; pinned?: string; dir?: string; storeId?: string } = {}): Harness {
	const savedBodies: string[] = [];
	const saveCalls: Array<{ changeName: string; prefix: string; storeId: string | undefined }> = [];
	let savedNotes = 0;
	const saver = createReportSaver({
		resolveChangeRoot: async () => ({ kind: "ok", changeRoot: options.dir ?? "/plan/changes/alpha" }),
	});
	const tool = createVerifyReportSaveTool({
		activePrefix: () => options.prefix,
		pinned: () => options.pinned,
		storeId: () => options.storeId,
		save: async (body, changeName, prefix, storeId) => {
			savedBodies.push(body);
			saveCalls.push({ changeName, prefix, storeId });
			return saver(body, changeName, prefix, storeId);
		},
		onSaved: () => {
			savedNotes += 1;
		},
	});
	return { tool, saveCalls, savedCount: () => savedNotes };
}

/** Call the tool the way the host would. */
async function call(tool: Harness["tool"], params: { body: string }) {
	return await tool.execute("call-0", params, undefined, undefined, erasedToolContext(tool, {}));
}

test("the registration shape: inactive by default, named, with prompt text", () => {
	const { tool } = harness();
	expect(tool.name).toBe(TOOL_NAME_VERIFY_REPORT_SAVE);
	expect(tool.defaultActive).toBe(false);
	expect(tool.promptSnippet).toBeDefined();
	expect((tool.promptGuidelines ?? []).length).toBeGreaterThan(0);
	// The guidelines name the tool, which is what ties them to a call the model can make.
	expect((tool.promptGuidelines ?? []).join("\n")).toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
});

test("the only parameter is the report body", () => {
	const { tool } = harness();
	const required = Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties);
	expect(required).toEqual(["body"]);
});

test("a save outside a verification step is refused before any write", async () => {
	const { tool, saveCalls } = harness({ prefix: undefined, pinned: "alpha" });
	const result = await call(tool, { body: "report" });
	expect(result.isError).toBe(true);
	expect(result.content[0]).toMatchObject({ text: VERIFY_REPORT_NOT_VERIFYING_REASON });
	expect(saveCalls).toEqual([]);
});

test("a save while the change is not pinned is refused before any write", async () => {
	const { tool, saveCalls } = harness({ prefix: "verify", pinned: undefined });
	const result = await call(tool, { body: "report" });
	expect(result.isError).toBe(true);
	expect(result.content[0]).toMatchObject({ text: VERIFY_REPORT_UNPINNED_REASON });
	expect(saveCalls).toEqual([]);

	// spec / 対象が固定されていない検証の保存を断る, シナリオ「未固定の拒否理由を開き直しでも案内する」:
	// the reason must guide both routes, and comparing to the constant alone would not notice the
	// guidance being deleted out of it (d-verify3 W-1).
	const reason = (result.content[0] as { text: string }).text;
	expect(reason).toContain("ask which change");
	expect(reason).toContain("reopen the verification with the change named");
	expect(reason).toContain("/opsx-verify <change>");
	expect(reason).toContain("/skill:sprt-opsx-verify-deep <change>");
});

test("an empty body is refused and nothing is created", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-verify-tool-"));
	try {
		const { tool, savedCount } = harness({ prefix: "verify", pinned: "alpha", dir });
		const result = await call(tool, { body: "   " });
		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ text: VERIFY_REPORT_EMPTY_BODY_REASON });
		expect(await readdir(dir)).toEqual([]);
		expect(savedCount()).toBe(0);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a successful save returns the created path and notes the obligation done", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-verify-tool-"));
	try {
		const { tool, saveCalls } = harness({ prefix: "d-verify", pinned: "alpha", dir });
		const result = await call(tool, { body: "# Deep report\n\nPASS" });
		expect(result.isError).toBeUndefined();
		expect(result.content[0]).toMatchObject({ text: `saved: ${join(dir, "d-verify1.md")}` });
		expect(saveCalls).toEqual([{ changeName: "alpha", prefix: "d-verify", storeId: undefined }]);
		expect(await Bun.file(join(dir, "d-verify1.md")).text()).toBe("# Deep report\n\nPASS");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

// Spec `verification-report-saving` / 督促の境界と通知の経路: the save path carries no mode check
// at all — the guarantee is mode-independent. The nudge side branches on the context; this side
// must not (d-verify1 W-3).
test("a save succeeds in the non-interactive tool contexts, under the same numbering", async () => {
	const dir = await mkdtemp(join(tmpdir(), "spirits-verify-tool-mode-"));
	try {
		for (const mode of ["print", "json"] as const) {
			const { tool, savedCount } = harness({ prefix: "verify", pinned: "alpha", dir });
			const result = await tool.execute(
				"call-0",
				{ body: `body from ${mode}` },
				undefined,
				undefined,
				erasedToolContext(tool, { mode }),
			);
			expect(result.isError).toBeUndefined();
			expect(savedCount()).toBe(1);
		}
		// Same series, same rules: the second save of the same change is the next number.
		expect((await readdir(dir)).sort()).toEqual(["verify1.md", "verify2.md"]);
		expect(await Bun.file(join(dir, "verify2.md")).text()).toBe("body from json");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
