/**
 * The step window around the save tool, and the pin it carries.
 *
 * The routing layer owns the step; this file registers after it, so the assertions here are exactly
 * the ordering the verify header claims: the `input` handler reads the step the routing just
 * updated, `agent_settled` sees a closed step for the non-continuing deep verification (abort
 * included), and the continuing `opsx-verify` stays open (spec `verification-report-saving` /
 * 検証ステップのあいだだけ保存手段を有効にする).
 */

import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TOOL_NAME_VERIFY_REPORT_SAVE, VERIFY_REPORT_UNPINNED_NOTICE } from "../src/constants.ts";
import { parseCommandInput } from "../src/routing/phase.ts";
import { registerDualModelRouting } from "../src/routing/register.ts";
import { registerVerifyReportSaving } from "../src/verify/register.ts";
import type { ChangeRootResolver } from "../src/verify/change-root.ts";
import { asExtensionApi, erasedToolContext, fakeModel, slashCommandInfo } from "./host/fake-pi.ts";
import { AUTO_SELECTION, FakePi, fakeCatalog, makeInputEvent, makeRequest, makeSettledEvent } from "./routing/fake-pi.ts";

interface Setup {
	pi: FakePi;
	dir: string;
	ctx: ExtensionContext;
	notices: string[];
	stderrLines: string[];
	/** The registered save tool, driven the way the host would. */
	saveTool: FakePi["tools"][number];
	/** Route one request so the step counts as resolved, the way a real run does. */
	resolved(): void;
}

async function setup(
	mode: "tui" | "rpc" | "print" | "json" = "tui",
	overrides: {
		resolveChangeRoot?: ChangeRootResolver;
		listChangeNames?: (storeId: string | undefined) => Promise<string[]>;
	} = {},
): Promise<Setup & { dispose(): Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "spirits-verify-register-"));
	const pi = new FakePi();
	const routing = registerDualModelRouting(asExtensionApi(pi));
	const stderrLines: string[] = [];
	registerVerifyReportSaving(asExtensionApi(pi), {
		phase: routing.phase,
		listChangeNames: overrides.listChangeNames ?? (async () => ["alpha", "beta"]),
		resolveChangeRoot: overrides.resolveChangeRoot ?? (async () => ({ kind: "ok", changeRoot: dir })),
		writeStderr: (line) => void stderrLines.push(line),
	});
	// The starters have to be commands pi would really expand (routing phase, design Decision 9).
	pi.slashCommands = [
		slashCommandInfo("opsx-verify", "prompt"),
		slashCommandInfo("skill:sprt-opsx-verify-deep", "skill"),
		slashCommandInfo("opsx-apply", "prompt"),
	];
	pi.settings = { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" };
	const catalog = fakeCatalog({
		mode,
		available: [fakeModel("anthropic", "claude-sonnet-4-5")],
		authedProviders: ["anthropic"],
		model: AUTO_SELECTION,
	});
	const saveTool = pi.tools.find((tool) => tool.name === TOOL_NAME_VERIFY_REPORT_SAVE);
	if (!saveTool) throw new Error("the verify layer did not register its tool");
	return {
		pi,
		dir,
		ctx: catalog.ctx,
		notices: catalog.notices,
		stderrLines,
		saveTool,
		/** Stand for the run's request having really resolved, the way the route records it. */
		resolved: () => void pi.route()(makeRequest(), catalog.ctx),
		dispose: async () => void (await rm(dir, { recursive: true, force: true })),
	};
}

/** Save through the registered tool, the way the model's call reaches it. */
async function saveThrough(setup: Setup, body: string) {
	return await setup.saveTool.execute("call-0", { body }, undefined, undefined, erasedToolContext(setup.saveTool, {}));
}

test("the starter opens the window and its argument pins the target", async () => {
	const s = await setup();
	try {
		expect(s.pi.getActiveTools()).not.toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		expect(s.pi.getActiveTools()).toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
		// The pinned target is what the save writes under; an unpinned save would refuse.
		const result = await saveThrough(s, "report body");
		expect(result.isError).toBeUndefined();
		expect(await Bun.file(join(s.dir, "verify1.md")).text()).toBe("report body");
	} finally {
		await s.dispose();
	}
});

for (const [starter, filename] of [
	["/opsx-verify", "verify1.md"],
	["/skill:sprt-opsx-verify-deep", "d-verify1.md"],
] as const) {
	test(`reopening with ${starter} announces the unpinned close once and saves the new report`, async () => {
		const targets: string[] = [];
		const s = await setup("tui", {
			resolveChangeRoot: async (name) => {
				targets.push(name);
				return { kind: "ok", changeRoot: s.dir };
			},
		});
		try {
			await s.pi.fire("input", makeInputEvent("/opsx-verify"), s.ctx);
			expect(s.notices).not.toContain(VERIFY_REPORT_UNPINNED_NOTICE);
			await s.pi.fire("input", makeInputEvent(`${starter} beta`), s.ctx);
			expect(s.notices.filter((line) => line === VERIFY_REPORT_UNPINNED_NOTICE)).toHaveLength(1);
			expect(s.pi.getActiveTools()).toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
			expect((await saveThrough(s, "replacement report")).isError).toBeUndefined();
			expect(targets).toEqual(["beta"]);
			expect(await Bun.file(join(s.dir, filename)).text()).toBe("replacement report");
			await s.pi.fire("agent_settled", makeSettledEvent(false), s.ctx);
			await s.pi.fire("input", makeInputEvent("/opsx-apply beta"), s.ctx);
			expect(s.notices.filter((line) => line === VERIFY_REPORT_UNPINNED_NOTICE)).toHaveLength(1);
		} finally {
			await s.dispose();
		}
	});
}

test("leaving the workflow closes the window", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		await s.pi.fire("input", makeInputEvent("/opsx-apply alpha"), s.ctx);
		expect(s.pi.getActiveTools()).not.toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
	} finally {
		await s.dispose();
	}
});

test("the deep verification closes its window at settle, abort included", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/skill:sprt-opsx-verify-deep beta"), s.ctx);
		expect(s.pi.getActiveTools()).toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
		await s.pi.fire("agent_settled", makeSettledEvent(true), s.ctx);
		expect(s.pi.getActiveTools()).not.toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
	} finally {
		await s.dispose();
	}
});

test("the continuing verify keeps its window open across an aborted settle", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		await s.pi.fire("agent_settled", makeSettledEvent(true), s.ctx);
		// The answer to the step's question arrives on the next run; the tool has to be visible there.
		expect(s.pi.getActiveTools()).toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
	} finally {
		await s.dispose();
	}
});

test("a save keeps the window open for the continuing step", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		await saveThrough(s, "first");
		expect(s.pi.getActiveTools()).toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
	} finally {
		await s.dispose();
	}
});

test("the window only ever touches this tool's name in the active set", async () => {
	const s = await setup();
	try {
		s.pi.setActiveTools(["other-extension-tool"]);
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		expect(s.pi.getActiveTools().sort()).toEqual(["other-extension-tool", TOOL_NAME_VERIFY_REPORT_SAVE]);
		await s.pi.fire("input", makeInputEvent("/opsx-apply alpha"), s.ctx);
		expect(s.pi.getActiveTools()).toEqual(["other-extension-tool"]);
	} finally {
		await s.dispose();
	}
});

test("a session start takes the tool back out", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		await s.pi.fire("session_start", { reason: "resume" }, s.ctx);
		expect(s.pi.getActiveTools()).not.toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
	} finally {
		await s.dispose();
	}
});

test("a plain answer pins only when it names a listed change exactly", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify"), s.ctx);
		s.resolved();
		expect(s.pi.getActiveTools()).toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
		// Unpinned: the save refuses, nothing is written.
		expect((await saveThrough(s, "body")).isError).toBe(true);

		await s.pi.fire("input", makeInputEvent("それ"), s.ctx);
		expect((await saveThrough(s, "body")).isError).toBe(true);

		await s.pi.fire("input", makeInputEvent("beta"), s.ctx);
		expect((await saveThrough(s, "body")).isError).toBeUndefined();
		expect(await Bun.file(join(s.dir, "verify1.md")).text()).toBe("body");
	} finally {
		await s.dispose();
	}
});

test("a steering input changes neither the window nor the pin", async () => {
	const s = await setup();
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		await s.pi.fire("input", makeInputEvent("mid-run steer", "steer"), s.ctx);
		expect(s.pi.getActiveTools()).toContain(TOOL_NAME_VERIFY_REPORT_SAVE);
	} finally {
		await s.dispose();
	}
});

// d-verify1 W-5: the verify layer reads the line through the routing's one split, so "is this a
// command pi expands" and "where is its first argument" can never disagree between the layers.
test("the command line is read once, the routing's way", () => {
	expect(parseCommandInput("/opsx-verify alpha")).toMatchObject({
		commandName: "opsx-verify",
		firstArgument: "alpha",
		rest: "alpha",
	});
	expect(parseCommandInput("/skill:sprt-opsx-verify-deep beta --store s")).toMatchObject({
		commandName: "skill:sprt-opsx-verify-deep",
		firstArgument: "beta",
		rest: "beta --store s",
	});
	expect(parseCommandInput("/opsx-verify")).toMatchObject({ firstArgument: "", rest: "" });
	expect(parseCommandInput("/skill:sprt-opsx-verify-deep")).toMatchObject({ firstArgument: "", rest: "" });
	expect(parseCommandInput("alpha")).toBeUndefined();
	// pi reads a skill name to the first space only: a tab there is nobody's argument boundary, and
	// the name pi would read matches no starter, so no step opens either way.
	expect(parseCommandInput("/skill:foo\tbar")).toMatchObject({ commandName: "skill:foo\tbar", firstArgument: "" });
});

test("a later input naming another change does not move the save destination (d-verify1 C-1)", async () => {
	const dirs: Record<string, string> = {};
	for (const name of ["alpha", "beta"]) dirs[name] = await mkdtemp(join(tmpdir(), `spirits-verify-${name}-`));
	const s = await setup("tui", {
		resolveChangeRoot: async (changeName) => ({ kind: "ok", changeRoot: dirs[changeName]! }),
	});
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha"), s.ctx);
		s.resolved();
		// The user answers a clarification with another listed change's name: the pin is frozen at
		// alpha, so the report still lands in alpha's directory and beta's stays empty.
		await s.pi.fire("input", makeInputEvent("beta"), s.ctx);
		const result = await saveThrough(s, "alpha's report");
		expect(result.isError).toBeUndefined();
		expect(await Bun.file(join(dirs.alpha!, "verify1.md")).text()).toBe("alpha's report");
		expect(await readdir(dirs.beta!)).toEqual([]);
	} finally {
		await s.dispose();
		for (const dir of Object.values(dirs)) await rm(dir, { recursive: true, force: true });
	}
});

test("the opening line's --store reaches the resolver; a bare answer carries none (d-verify1 W-1)", async () => {
	const seen: Array<{ changeName: string; storeId: string | undefined }> = [];
	const s = await setup("tui", {
		resolveChangeRoot: async (changeName, storeId) => {
			seen.push({ changeName, storeId });
			return { kind: "ok", changeRoot: s.dir };
		},
	});
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify alpha --store s1"), s.ctx);
		expect((await saveThrough(s, "body")).isError).toBeUndefined();
		expect(seen).toEqual([{ changeName: "alpha", storeId: "s1" }]);

		// A clarification answer names the change but carries no store: the resolver is asked to
		// resolve nearest, and the flag form `--store=s2` travels the same way as the spaced form.
		seen.length = 0;
		await s.pi.fire("input", makeInputEvent("/skill:sprt-opsx-verify-deep"), s.ctx);
		s.resolved();
		await s.pi.fire("input", makeInputEvent("beta"), s.ctx);
		expect((await saveThrough(s, "body")).isError).toBeUndefined();
		expect(seen).toEqual([{ changeName: "beta", storeId: undefined }]);

		seen.length = 0;
		await s.pi.fire("input", makeInputEvent("/skill:sprt-opsx-verify-deep beta --store=s2"), s.ctx);
		expect((await saveThrough(s, "body")).isError).toBeUndefined();
		expect(seen).toEqual([{ changeName: "beta", storeId: "s2" }]);

		// d-verify2 C-1: an opening line that carries the store but no change name — the answer
		// names it, and the resolution must still go through the opening line's store.
		seen.length = 0;
		await s.pi.fire("input", makeInputEvent("/opsx-verify --store s1"), s.ctx);
		s.resolved();
		await s.pi.fire("input", makeInputEvent("alpha"), s.ctx);
		expect((await saveThrough(s, "body")).isError).toBeUndefined();
		expect(seen).toEqual([{ changeName: "alpha", storeId: "s1" }]);
	} finally {
		await s.dispose();
	}
});

// d-verify3 C-1: the product wiring reads the pin's name list through the same store the save
// resolves against. A change that lives only in the named store pins; a change the store does not
// have stays un-pinned instead of pinning against a different change set.
test("pinning and saving read the same store (d-verify3 C-1)", async () => {
	const listedStores: Array<string | undefined> = [];
	const resolved: Array<{ changeName: string; storeId: string | undefined }> = [];
	const s = await setup("tui", {
		listChangeNames: async (storeId) => {
			listedStores.push(storeId);
			// The store holds `in-store`; the nearest root holds `local-only`.
			return storeId === "s1" ? ["in-store"] : ["local-only"];
		},
		resolveChangeRoot: async (changeName, storeId) => {
			resolved.push({ changeName, storeId });
			return storeId === "s1" && changeName === "in-store"
				? { kind: "ok", changeRoot: s.dir }
				: { kind: "error", reason: `no change ${changeName} in ${storeId ?? "the nearest root"}` };
		},
	});
	try {
		await s.pi.fire("input", makeInputEvent("/opsx-verify --store s1"), s.ctx);
		s.resolved();

		// A local-only name does not pin while the verification carries a store: the save is refused
		// before anything is written, and nothing reached the resolver.
		await s.pi.fire("input", makeInputEvent("local-only"), s.ctx);
		expect((await saveThrough(s, "body")).isError).toBe(true);
		expect(resolved).toEqual([]);

		// The store's own change pins through the same store, and the save resolves against it.
		await s.pi.fire("input", makeInputEvent("in-store"), s.ctx);
		expect((await saveThrough(s, "body")).isError).toBeUndefined();
		expect(await Bun.file(join(s.dir, "verify1.md")).text()).toBe("body");
		// Every offered line — the opening line's first argument included — reads the store's list.
		expect(listedStores).toEqual(["s1", "s1", "s1"]);
		expect(resolved).toEqual([{ changeName: "in-store", storeId: "s1" }]);
	} finally {
		await s.dispose();
	}
});
