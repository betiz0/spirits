/**
 * `/spirits-role status`: the one notice that says how the routing is running.
 *
 * The report is built from the phase, the settings file, and the host's catalog, so the cases below
 * set those three and read the notice back. The rule the shape follows is the question a user asks when
 * routing is not doing what they set: is it on at all, what is locked, what step is running, what the
 * last request actually used, where each role's model comes from, and what the settings file holds that
 * routing will not read (spec `managed-commands` / `/spirits-role status`).
 */

import { expect, test } from "bun:test";
import type { PiModel, SessionEntry } from "@earendil-works/pi-coding-agent";
import { COMMAND_SPIRITS_ROLE, ROLE_ENTRY_TYPE, STEP_ENTRY_TYPE } from "../src/constants.ts";
import { readRoutingSettings } from "../src/config.ts";
import { registerManagedCommands } from "../src/commands/register.ts";
import { formatRoleStatus } from "../src/commands/role.ts";
import type { RoleStatusReport } from "../src/commands/role.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import { FakePi, fakeCommandContext, makeCustomEntry } from "./routing/fake-pi.ts";

const FAKE_MODEL: PiModel = { provider: "compat-fake", id: "fake-model", api: "openai" };
const FAKE_STRONG: PiModel = { provider: "compat-fake", id: "fake-strong", api: "openai" };
const CATALOG = [FAKE_MODEL, FAKE_STRONG];
/** The routing entry, which is what a session has to select for routing to be in force. */
const AUTO: PiModel = { provider: "spirits", id: "auto", api: "pi-virtual" };

function wire(settings: Record<string, unknown>) {
	const pi = new FakePi();
	pi.settings = settings;
	const phase = createRoutingPhase({
		listCommands: () => [
			{ name: "skill:openspec-apply-change", source: "skill" },
			{ name: "skill:sprt-opsx-verify-deep", source: "skill" },
		],
	});
	// A routing that already answered one strong request, which is the state `status` reports on.
	registerManagedCommands(pi, {
		phase,
		patchSettings: () => {},
		patchSettingsPath: () => {},
		lastRequest: () => ({ role: "strong", model: "compat-fake/fake-strong", thinkingLevel: "high" }),
	});
	return { pi, phase };
}

async function status(pi: FakePi, options: Parameters<typeof fakeCommandContext>[0] = {}) {
	const context = fakeCommandContext({ available: CATALOG, model: AUTO, ...options });
	await pi.commands.get(COMMAND_SPIRITS_ROLE)!.handler("status", context.ctx);
	return context.notices.join("\n");
}

// spec scenario "振り分けが有効なときの全項目"
test("reports every field when routing is in force", async () => {
	const { pi, phase } = wire({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: {
			role: "normal",
			normal: "compat-fake/fake-model",
			strong: "compat-fake/fake-strong",
			thinking: { strong: "high" },
			steps: { "opsx-apply": { thinking: "max" } },
		},
	});
	phase.setRole("normal");
	phase.handleInput("/skill:openspec-apply-change x");
	phase.requestResolved();

	const report = await status(pi, { authedProviders: ["compat-fake"] });

	expect(report).toContain("routing: on");
	expect(report).toContain("lock: normal");
	expect(report).toContain("step: opsx-apply (continuing)");
	// The request that ran, not the setting it hopes for: role, physical model, and the level asked for.
	expect(report).toContain("last request: strong on compat-fake/fake-strong at high");
	expect(report).toContain("normal: compat-fake/fake-model (models.normal)");
	expect(report).toContain("strong: compat-fake/fake-strong (models.strong, thinking high)");
	expect(report).toContain("step settings: opsx-apply thinking max");
});

// spec scenario "物理モデルを選んでいれば無効と出る": the report stays readable, only the verdict changes.
test("reports routing disabled on a physical model", async () => {
	const { pi, phase } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { role: "strong" } });
	phase.setRole("strong");

	const report = await status(pi, { model: FAKE_MODEL });

	expect(report).toContain("routing: off");
	expect(report).toContain("lock: strong");
	expect(report).toContain("normal: compat-fake/fake-model (pi's default model)");
});

// An unset target and an unusable one are different facts, and only the second is worth alarming about.
test("separates an unset target from an unusable one", async () => {
	const unset = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });
	expect(await status(unset.pi)).toContain("strong: unset (models.strong is not set)");

	const unusable = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: "nowhere/nothing" } });
	expect(await status(unusable.pi)).toContain("strong: unusable");
});

// spec scenario "ステップの既定ロールで走っている間のロック": the lock line is the lock, and the step line
// carries the role the step actually runs.
test("reports the lock, not the step default, during a strong-default step", async () => {
	const { pi, phase } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { role: "normal" } });
	phase.setRole("normal");
	phase.handleInput("/skill:sprt-opsx-verify-deep some-change");
	phase.requestResolved();

	const report = await status(pi, { authedProviders: ["compat-fake"] });

	expect(report).toContain("lock: normal");
	expect(report).toContain("step: sprt-opsx-verify-deep");
	expect(report).toContain("runs strong");
});

// spec scenario "使えない normal の対象": the reason and the model that answers instead, not the setting.
test("reports an unusable normal target with its reason and the model that answers", async () => {
	const { pi } = wire({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { normal: "compat-fake/fake-strong" },
	});

	// Nothing in `compat-fake` has credentials here, so the configured target cannot answer even though
	// it names a model that exists. The line has to carry the reason and the model that answers instead.
	const report = await status(pi);

	expect(report).toContain("normal: compat-fake/fake-model");
	expect(report).toContain("has no credentials for compat-fake");
	expect(report).toContain("running pi's default model");
});

// spec scenario "使えない normal の対象" for the other role: the replacement is only useful when the line
// says where it comes from, because the setting the user wrote names a different model.
test("an unusable strong names where its replacement comes from", async () => {
	const { pi } = wire({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { strong: "nowhere/nothing" },
	});

	const report = await status(pi, { authedProviders: ["compat-fake"] });

	expect(report).toContain("strong: unusable");
	// The model that answers, and the source that put it there.
	expect(report).toContain("runs compat-fake/fake-model (pi's default model)");
});

// spec "status のロックと解決結果は実際の位相と解決を示す": a strong request that falls back to normal
// carries normal's thinking level, so that is the level the report has to name — strong's own level is a
// level no request sends while strong has nothing to run on.
test("an unresolved strong reports the level its requests carry", async () => {
	const unset = wire({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { thinking: { normal: "low", strong: "max" } },
	});
	expect(await status(unset.pi, { authedProviders: ["compat-fake"] })).toContain("strong: unset (models.strong is not set; carries thinking low)");

	const unusable = wire({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { strong: "nowhere/nothing", thinking: { normal: "low", strong: "max" } },
	});
	const report = await status(unusable.pi, { authedProviders: ["compat-fake"] });
	expect(report).toContain("carries thinking low");
	expect(report).not.toContain("thinking max");
});

// `models.strong` written but unreadable is not the same as `models.strong` absent.
test("reports an unreadable models.strong apart from unset", async () => {
	const report = await status(wire({ defaultProvider: "compat-fake", defaultModel: "fake-model", models: { strong: 42 } }).pi);

	expect(report).toContain("ignored settings:");
	expect(report).toContain("models.strong: not a provider/id or model id");
	expect(report).not.toContain("models.strong is not set");
});

// spec scenario "綴りの違うステップ名": the step reader keys on the exact spelling, so a key that only
// differs by case is a step that is not on the list — it is not read, and the report has to say so.
test("reports a mixed-case step key as ignored", async () => {
	const settings = {
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { steps: { "OpsX-Propose": { role: "strong" } } },
	};
	const report = await status(wire(settings).pi);

	expect(readRoutingSettings(settings).steps).toBeUndefined();
	expect(report).toContain("models.steps.OpsX-Propose: not a step on the list");
});

// spec scenario "設定値の不正区別": a value routing will not read is named with its reason, so the user
// does not have to guess which of their settings took effect.
test("names the settings values routing ignores", async () => {
	const { pi } = wire({
		defaultProvider: "compat-fake",
		defaultModel: "fake-model",
		models: { thinking: { normal: 42 }, steps: { "opsx-apply": { role: "teleport" } } },
	});

	const report = await status(pi);

	expect(report).toContain("ignored settings:");
	expect(report).toContain("models.thinking.normal");
	expect(report).toContain("models.steps.opsx-apply.role");
});

test("says no request has run since the last reload", async () => {
	const pi = new FakePi();
	pi.settings = { defaultProvider: "compat-fake", defaultModel: "fake-model" };
	registerManagedCommands(pi, { phase: createRoutingPhase(), patchSettings: () => {} });

	const report = await status(pi);

	expect(report).toContain("last request: none since the last reload");
});

// The report is a pure function of its input, which is what lets the wording be checked without a host.
test("renders the report in one message", () => {
	const report: RoleStatusReport = {
		routingEnabled: true,
		lock: "normal",
		last: { role: "normal", model: "compat-fake/fake-model" },
		normal: { role: "normal", target: "compat-fake/fake-model", source: "pi's default model" },
		strong: { role: "strong", target: "unset", source: "models.strong is not set" },
		stepSettings: [],
		ignored: [],
	};

	const text = formatRoleStatus(report);

	// One message, one line per fact, and no line for a section that has nothing in it.
	expect(text.split("\n")).toHaveLength(6);
	expect(text).not.toContain("step settings:");
	expect(text).not.toContain("ignored settings:");
	// A step that is not running is still reported, because "no step" is the answer to the question.
	expect(text).toContain("step: none");
});

// The records a report reads back are the ones the routing and the command surface wrote, so a step
// that ended stays ended in the report as well.
test("a step that ended reports no step", async () => {
	const branch: SessionEntry[] = [
		makeCustomEntry(ROLE_ENTRY_TYPE, { role: "strong" }),
		makeCustomEntry(STEP_ENTRY_TYPE, { step: "opsx-apply" }),
		makeCustomEntry(STEP_ENTRY_TYPE, { step: null }),
	];
	const { pi } = wire({ defaultProvider: "compat-fake", defaultModel: "fake-model" });

	// A reload reads that branch: the newest step record says "no step", so nothing is restored.
	const started = fakeCommandContext({ available: CATALOG, model: AUTO, branch });
	await pi.fire("session_start", { type: "session_start", reason: "reload" }, started.ctx);

	expect(await status(pi)).toContain("step: none");
});
