/**
 * What a host that moved under spirits costs the session.
 *
 * pi initializes an extension by calling its factory and discards *every* registration the extension
 * made if that call throws (`core/extensions/loader.ts`). The tests here break one optional layer at
 * a time and check two things: the core is still registered, and the user is told once about the
 * layer that went missing.
 */

import { expect, test } from "bun:test";
import type { ExtensionContext, PiModel } from "@earendil-works/pi-coding-agent";
import {
	COMMAND_SPIRITS_CLEAR,
	COMMAND_SPIRITS_MODEL,
	TOOL_NAME_SKILL_SAVE,
} from "../src/constants.ts";
import { MANAGE_TODOS_TOOL_NAME } from "../src/todo/tool.ts";
import spiritsExtension, { fallbackRoutingPhase } from "../src/index.ts";
import { createChildModelResolver } from "../src/routing/child.ts";
import { registerDualModelRouting } from "../src/routing/register.ts";
import { AUTO_SELECTION, FakePi, fakeCatalog, fakeToolContext, makeRequest, withoutRoleApi } from "./routing/fake-pi.ts";

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
