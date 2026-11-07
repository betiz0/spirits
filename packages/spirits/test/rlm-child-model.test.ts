/**
 * The two halves joined the way `src/index.ts` joins them: the routing child-model resolver injected
 * into `createRlmHostFn`, driven through a cell.
 *
 * `rlm-hostfn.test.ts` proves the host function obeys whatever resolver it is given and
 * `routing-child-model.test.ts` proves what the resolver decides. This file is the seam between them:
 * the values read at the moment the child starts are the values the child gets, which is what makes
 * a settings edit or a phase change land on the next child and not on a child that already started.
 */

import { expect, test } from "bun:test";
import type { ExtensionToolContext, PiModel } from "@earendil-works/pi-coding-agent";
import type { HostFnScope } from "../src/repl/registry.ts";
import { MODEL_ROLE_STRONG, SKILL_COMMAND_PREFIX } from "../src/constants.ts";
import type { RoutingSettings } from "../src/config.ts";
import { createRlmHostFn, type SpawnFn } from "../src/rlm/hostfn.ts";
import type { RlmTokens } from "../src/rlm/spawn.ts";
import { createChildModelResolver } from "../src/routing/child.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { AUTO_SELECTION, fakeToolContext } from "./routing/fake-pi.ts";

const SONNET: PiModel = { provider: "anthropic", id: "claude-sonnet-4-5" };
const OPUS: PiModel = { provider: "anthropic", id: "claude-opus-4-7" };
const LUNA: PiModel = { provider: "openai", id: "gpt-5.6-luna" };
const SETTINGS: RoutingSettings = {
	defaultProvider: "anthropic",
	defaultModelId: "claude-sonnet-4-5",
	strong: { provider: "anthropic", modelId: "claude-opus-4-7" },
};
const USAGE: RlmTokens = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 };

/** Host function and resolver wired as the entry point wires them, over a capturing spawn. */
function harness(options: { settings?: RoutingSettings } = {}) {
	let settings = options.settings ?? SETTINGS;
	const phase = createRoutingPhase();
	const models: PiModel[] = [];
	const spawn: SpawnFn = async (params) => {
		models.push(params.model);
		return { outcome: "completed", text: "ok", sessionId: `child-${models.length}`, tokens: USAGE, cost: 0 };
	};
	const entry = createRlmHostFn({
		pi: { appendEntry: () => {} },
		depth: 0,
		maxDepth: 2,
		spawn,
		resolveChildModel: createChildModelResolver({ phase, readSettings: () => settings }),
	});
	return {
		entry,
		phase,
		models,
		setSettings(next: RoutingSettings): void {
			settings = next;
		},
		/** Enter the strong phase the way the target skill command does. */
		enterStrong(): void {
			phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep fix-managed-rlm-child-model`);
		},
	};
}

/** A cell scope on a session that selected `spirits/auto`, backed by a catalog and an empty branch. */
function scope(signal?: AbortSignal): HostFnScope {
	const { ctx } = fakeToolContext({
		available: [SONNET, OPUS, LUNA],
		authedProviders: ["anthropic", "openai"],
		branch: [],
	});
	const toolContext = { ...ctx, cwd: "/work", model: AUTO_SELECTION } as ExtensionToolContext;
	return {
		signal: signal ?? new AbortController().signal,
		toolContext,
		print: () => {},
		setValue: () => {},
		recordToolCall: () => {},
		finished: false,
	};
}

function call(entry: ReturnType<typeof harness>["entry"], cellScope: HostFnScope, prompt: string): Promise<string> {
	return Promise.resolve(entry.create(cellScope)(prompt)) as Promise<string>;
}

function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

// spec "dual-model-routing / strong 位相の子は strong の対象"（注入後の合成）
test("a strong phase child is spawned on the strong target", async () => {
	const { entry, enterStrong, models } = harness();
	enterStrong();

	expect(await call(entry, scope(), "delegate")).toBe("ok");
	expect(models).toEqual([OPUS]);
});

// spec "dual-model-routing / 設定変更は次の子から反映する"
test("a strong target change reaches the next child while the phase stays strong", async () => {
	const { entry, enterStrong, models, phase, setSettings } = harness();
	enterStrong();

	await call(entry, scope(), "first");
	// The phase stays strong and only the strong setting moves to another usable model.
	setSettings({ ...SETTINGS, strong: { provider: "openai", modelId: "gpt-5.6-luna" } });
	await call(entry, scope(), "second");

	expect(phase.current()).toBe(MODEL_ROLE_STRONG);
	// The two children differ, and the second one carries the moved setting rather than the first.
	expect(models).toEqual([OPUS, LUNA]);
});

// design Decision 4: the resolution reads the values in effect when the child starts, not the ones
// in effect when the cell asked.
test("a change during the queue wait is picked up by the waiting call", async () => {
	// The strong target starts on a model of its own, so neither the phase change nor the settings change
	// alone can produce the expected child: only reading both after the wait gives OPUS.
	let settings: RoutingSettings = { ...SETTINGS, strong: { provider: LUNA.provider, modelId: LUNA.id } };
	const phase = createRoutingPhase();
	const models: PiModel[] = [];
	const resolvers: Array<() => void> = [];
	const spawn: SpawnFn = (params) =>
		new Promise((resolve) => {
			models.push(params.model);
			resolvers.push(() => resolve({ outcome: "completed", text: params.prompt, sessionId: "c", tokens: USAGE, cost: 0 }));
		});
	const entry = createRlmHostFn({
		pi: { appendEntry: () => {} },
		depth: 0,
		maxDepth: 2,
		spawn,
		resolveChildModel: createChildModelResolver({ phase, readSettings: () => settings }),
	});

	// First call takes the queue and never resolves on its own.
	const first = call(entry, scope(), "first");
	await tick();
	// Second call waits behind it. While it waits, the phase goes strong and the strong target moves.
	const second = call(entry, scope(), "second");
	await tick();
	expect(models).toEqual([SONNET]);

	phase.handleInput(`${SKILL_COMMAND_PREFIX}sprt-opsx-verify-deep fix-managed-rlm-child-model`);
	settings = { ...settings, strong: { provider: OPUS.provider, modelId: OPUS.id } };

	resolvers[0]?.();
	expect(await first).toBe("first");
	await tick();
	// The waiting call resolved its child after the change, not with the values it was called with.
	expect(models).toEqual([SONNET, OPUS]);

	resolvers[1]?.();
	expect(await second).toBe("second");
});

// A parent on a physical model is unaffected by the wiring: the strong target never replaces it.
test("a physical parent still passes through after the wiring", async () => {
	const { entry, enterStrong, models } = harness();
	enterStrong();
	const parentScope = scope();
	(parentScope.toolContext as { model?: PiModel }).model = SONNET;

	await call(entry, parentScope, "delegate");
	expect(models).toEqual([SONNET]);
});
