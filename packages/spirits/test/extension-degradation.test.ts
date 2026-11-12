/**
 * What a host that moved under spirits costs the session.
 *
 * pi initializes an extension by calling its factory and discards *every* registration the extension
 * made if that call throws (`core/extensions/loader.ts`). The tests here break one optional layer at
 * a time and check two things: the core is still registered, and the user is told once about the
 * layer that went missing.
 */

import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, PiModel, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	COMMAND_SPIRITS_CLEAR,
	COMMAND_SPIRITS_MODEL,
	DEFAULT_TODO_TOGGLE_KEY,
	ENV_ACTION_GUARD,
	ENV_AGENT_DIR,
	SETTINGS_FILE_NAME,
	TOOL_NAME_SKILL_SAVE,
} from "../src/constants.ts";
import { TODO_ENTRY_TYPE } from "../src/todo/state.ts";
import { MANAGE_TODOS_TOOL_NAME } from "../src/todo/tool.ts";
import spiritsExtension, { fallbackRoutingPhase } from "../src/index.ts";
import { createChildModelResolver } from "../src/routing/child.ts";
import { registerDualModelRouting } from "../src/routing/register.ts";
import { AUTO_SELECTION, FakePi, fakeCatalog, fakeToolContext, makeRequest, withoutRoleApi } from "./routing/fake-pi.ts";
import { makeToolContext } from "./support.ts";

const SONNET: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5", name: "Sonnet", api: "anthropic" };

/** A host whose virtual-model API throws, the way a pi that changed its signature would. */
class HostWithoutVirtualModel extends FakePi {
	override registerVirtualModel(): void {
		throw new Error("registerVirtualModel no longer accepts this shape");
	}
}

/** An official host whose command API throws. The commands are its only route to the same state. */
class HostWithoutCommandApi extends FakePi {
	override registerCommand(): void {
		throw new Error("registerCommand no longer accepts this shape");
	}
}

function toolNames(pi: FakePi): string[] {
	return pi.tools.map((tool) => tool.name);
}

/**
 * Load the extension with a temporary agent dir whose `settings.json` holds `content`, so the file the
 * entry point reads at load is the one the test wrote. `~/.spirits` stays untouched, and an absent
 * `content` leaves the dir without a settings file.
 *
 * `run` gets the loaded host and the dir, so a test can rewrite the settings file and load the extension
 * a second time the way `/reload` does. The agent dir stays pointed at for the whole run and is removed
 * with it, so a run leaves no temporary state behind.
 */
async function withSettingsDir<T>(
	content: string | undefined,
	run: (pi: FakePi, agentDir: string) => Promise<T>,
): Promise<T> {
	const agentDir = await mkdtemp(join(tmpdir(), "spirits-todo-settings-"));
	const previous = process.env[ENV_AGENT_DIR];
	process.env[ENV_AGENT_DIR] = agentDir;
	try {
		if (content !== undefined) await writeFile(join(agentDir, SETTINGS_FILE_NAME), content, "utf-8");
		const pi = new FakePi();
		expect(() => spiritsExtension(pi)).not.toThrow();
		return await run(pi, agentDir);
	} finally {
		if (previous === undefined) delete process.env[ENV_AGENT_DIR];
		else process.env[ENV_AGENT_DIR] = previous;
		await rm(agentDir, { recursive: true, force: true });
	}
}

/** A branch with one pending TODO, the smallest state the panel draws. */
function todoBranch(): SessionEntry[] {
	return [
		{
			type: "custom",
			customType: TODO_ENTRY_TYPE,
			data: { nextId: 2, items: [{ id: 1, text: "A1", done: false }] },
		},
	];
}

/** The TODO lines a loaded extension draws for that branch on the next `session_start`. */
async function panelLines(pi: FakePi): Promise<string[]> {
	const widgets: unknown[] = [];
	const base = fakeCatalog({ branch: todoBranch() });
	const ctx = {
		...base.ctx,
		mode: "tui",
		ui: { ...base.ctx.ui, setWidget: (_key: string, content: unknown) => void widgets.push(content) },
	} as unknown as ExtensionContext;

	await pi.fire("session_start", { reason: "startup" }, ctx);

	const factory = widgets.at(-1) as ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined;
	return factory ? factory(undefined, undefined).render(80) : [];
}

/** The core: the REPL tool with `rlm` in it, the harness tools, and the session TODO tool. */
function expectCoreRegistered(pi: FakePi): void {
	expect(toolNames(pi)).toContain("tsrepl");
	expect(toolNames(pi)).toContain(TOOL_NAME_SKILL_SAVE);
	expect(toolNames(pi)).toContain(MANAGE_TODOS_TOOL_NAME);
	// `rlm` reaches a cell through the tsrepl tool description, so this is where its presence shows.
	expect(pi.tools.find((tool) => tool.name === "tsrepl")?.description).toContain("await rlm(prompt)");
}

// spec scenario "a host that refuses an optional layer keeps the core".
test("a host that cannot take a virtual model keeps the core and says so once", async () => {
	const pi = new HostWithoutVirtualModel();
	expect(() => spiritsExtension(pi)).not.toThrow();
	expectCoreRegistered(pi);
	// The commands cover the gap the missing routing leaves, so they are registered here.
	expect([...pi.commands.keys()]).toContain(COMMAND_SPIRITS_MODEL);

	const first = fakeCatalog();
	await pi.fire("session_start", { reason: "startup" }, first.ctx);
	await pi.fire("session_start", { reason: "resume" }, first.ctx);

	expect(first.notices.filter((notice) => notice.includes("model routing"))).toHaveLength(1);
	expect(pi.errors).toEqual([]);
});

test("a host that cannot take the commands keeps the core and says so once", async () => {
	const pi = withoutRoleApi(new HostWithoutCommandApi());
	expect(() => spiritsExtension(pi)).not.toThrow();
	expectCoreRegistered(pi);
	expect(pi.commands.size).toBe(0);

	const first = fakeCatalog();
	await pi.fire("session_start", { reason: "startup" }, first.ctx);
	await pi.fire("session_start", { reason: "resume" }, first.ctx);

	expect(first.notices.filter((notice) => notice.includes(COMMAND_SPIRITS_CLEAR))).toHaveLength(1);
	expect(pi.errors).toEqual([]);
});

// The header is installed on `session_start`, so it fails inside a running session rather than at
// load, and pi catches handler errors on its own. What must not happen is the notice going out twice.
test("a header the host will not draw costs the header only", async () => {
	const pi = new FakePi();
	spiritsExtension(pi);

	const base = fakeCatalog();
	const ctx = {
		...base.ctx,
		// The header is TUI-only, so this is the case that reaches `setHeader`.
		mode: "tui",
		ui: {
			...base.ctx.ui,
			setHeader: () => {
				throw new Error("setHeader is gone");
			},
		},
	} as unknown as ExtensionContext;

	await pi.fire("session_start", { reason: "startup" }, ctx);
	await pi.fire("session_start", { reason: "resume" }, ctx);

	expect(pi.errors).toEqual([]);
	expect(base.notices.filter((notice) => notice.includes("startup header"))).toHaveLength(1);
	expectCoreRegistered(pi);
});

// The badge is drawn from inside the route, on the way to the user's answer.
test("a footer that refuses a status write does not stop the request", () => {
	const pi = new FakePi();
	pi.settings = { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" };
	const routing = registerDualModelRouting(pi, {
		onRole: () => {
			throw new Error("setStatus is gone");
		},
	});
	expect(routing.roleApi).toBe(true);

	const base = fakeCatalog({ available: [SONNET], authedProviders: ["anthropic"], model: AUTO_SELECTION });
	const ctx = {
		...base.ctx,
		ui: {
			...base.ctx.ui,
			setStatus: () => {
				throw new Error("setStatus is gone");
			},
		},
	} as unknown as ExtensionContext;

	expect(pi.route()(makeRequest(), ctx)).toMatchObject({ model: SONNET });
});

/**
 * The phase the child resolver gets when the routing layer never registered. `rlm` reads it once per
 * child, so the strong/normal choice survives; a parent on a physical model never reads it.
 */
test("the fallback phase carries the saved default role and the lock", () => {
	const phase = fallbackRoutingPhase(() => "strong");
	expect(phase.current()).toBe("strong");

	// `/spirits-role` locks a role for the session, and the lock beats the saved default.
	phase.setRole("normal");
	expect(phase.current()).toBe("normal");
});

test("a physical parent model still hands its own model to the child", () => {
	const resolve = createChildModelResolver({
		phase: fallbackRoutingPhase(() => "strong"),
		readSettings: () => ({ defaultRole: "strong" }),
	});
	const { ctx } = fakeToolContext({ available: [SONNET] });

	expect(resolve(SONNET, ctx)).toEqual(SONNET);
});

// The guard is the last registration and sits on the way to every bash call, so the two things worth
// holding are that a host which refuses the subscription loses only the guard, and that a loaded
// extension stops a shell loop without the entry wiring knowing anything about the rules.
test("a host that refuses tool_call keeps the core and loses only the bash action guard", async () => {
	// The fake's `on` is an overloaded signature, so the forward goes through the prototype with the
	// loose signature this host is pretending not to have.
	const subscribe = FakePi.prototype.on as (event: string, handler: unknown) => () => void;
	class HostWithoutToolCall extends FakePi {
		override on(event: string, handler: unknown): () => void {
			if (event === "tool_call") throw new Error("tool_call is gone");
			return subscribe.call(this, event, handler);
		}
	}

	const pi = new HostWithoutToolCall();
	expect(() => spiritsExtension(pi)).not.toThrow();
	expectCoreRegistered(pi);

	const first = fakeCatalog();
	await pi.fire("session_start", { reason: "startup" }, first.ctx);
	await pi.fire("session_start", { reason: "resume" }, first.ctx);

	expect(first.notices.filter((notice) => notice.includes("bash action guard"))).toHaveLength(1);
	expect(pi.errors).toEqual([]);
});

// spec "session-todo / 開閉キーは設定ファイル、環境変数、既定値の順に決まる": 読めない設定ファイル
// は設定の無い扱いになり、拡張の読み込みは失敗しない。
test("設定ファイルが無くても manage_todos とパネルが登録される", async () => {
	await withSettingsDir(undefined, async (pi) => {
		expect(toolNames(pi)).toContain(MANAGE_TODOS_TOOL_NAME);
		expect([...pi.shortcuts.keys()]).toEqual([DEFAULT_TODO_TOGGLE_KEY]);
		expect(await panelLines(pi)).toEqual(["○ #1 A1"]);
	});
});

test("設定ファイルが JSON として解釈できなくても manage_todos とパネルが登録される", async () => {
	await withSettingsDir("{ todo: ", async (pi) => {
		expect(toolNames(pi)).toContain(MANAGE_TODOS_TOOL_NAME);
		expect([...pi.shortcuts.keys()]).toEqual([DEFAULT_TODO_TOGGLE_KEY]);
		expect(await panelLines(pi)).toEqual(["○ #1 A1"]);
	});
});

test("設定ファイルの todo.toggleKey でショートカットが登録される", async () => {
	await withSettingsDir(JSON.stringify({ todo: { toggleKey: " Ctrl+Shift+K " } }), async (pi) => {
		expect([...pi.shortcuts.keys()]).toEqual(["ctrl+shift+k"]);
		expect(toolNames(pi)).toContain(MANAGE_TODOS_TOOL_NAME);
	});
});

// spec "session-todo / 開閉キーは設定ファイル、環境変数、既定値の順に決まる": 設定の変更は
// `/reload` で反映される。読み込みは拡張の読み込み時に 1 回だけなので、書き換えは factory を
// 呼び直すまで登録済みのキーを変えない。
test("設定ファイルの変更は再読み込みまで反映されない", async () => {
	await withSettingsDir(JSON.stringify({ todo: { toggleKey: "ctrl+shift+k" } }), async (first, agentDir) => {
		expect([...first.shortcuts.keys()]).toEqual(["ctrl+shift+k"]);

		await writeFile(join(agentDir, SETTINGS_FILE_NAME), JSON.stringify({ todo: { toggleKey: "alt+," } }), "utf-8");

		// 読み直さないランでは、書き換えたキーは登録されず古いキーのまま。
		expect([...first.shortcuts.keys()]).toEqual(["ctrl+shift+k"]);

		// `/reload` は拡張の factory を呼び直すため、そこで新しいキーが登録される。
		const second = new FakePi();
		expect(() => spiritsExtension(second)).not.toThrow();
		expect([...second.shortcuts.keys()]).toEqual(["alt+,"]);
	});
});

test("a loaded bash action guard stops a shell loop", async () => {
	process.env[ENV_ACTION_GUARD] = "enforce";
	try {
		const pi = new FakePi();
		spiritsExtension(pi);
		const handlers = pi.handlers.get("tool_call") ?? [];
		expect(handlers.length).toBeGreaterThan(0);

		const results = await Promise.all(
			handlers.map((handler) =>
				handler({ type: "tool_call", toolCallId: "call-1", toolName: "bash", input: { command: "for f in *; do wc -l \"$f\"; done" } }, makeToolContext({ cwd: process.cwd() })),
			),
		);
		expect(results.filter((result) => (result as { block?: boolean })?.block)).toHaveLength(1);
	} finally {
		delete process.env[ENV_ACTION_GUARD];
	}
});
