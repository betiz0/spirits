/**
 * The gate's summary resolution inside the route (fit-gate change, tasks 3.1–3.4).
 *
 * Only a `direct` request that arrives while the gate's ahead compaction is in flight, and whose
 * span passes the role target's own threshold, may move to a model that held the conversation.
 * Every other request resolves and reports exactly as before, and a moved request reports nothing:
 * a summary is neither the step's resolution nor the last request `status` names.
 */

import { expect, test } from "bun:test";
import type { ExtensionContext, ModelRouteRequest, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { PiModel } from "../src/types/host.ts";
import { fakeModel, slashCommandInfo, userMessage } from "./host/fake-pi.ts";
import { createNotificationGuard, createRoutingRoute, type RouteDecision, type RoutePhase } from "../src/routing/router.ts";
import { createRoutingPhase } from "../src/routing/phase.ts";
import type { RoutingSettings } from "../src/config.ts";
import { makeAssistantEntry } from "./routing/fake-pi.ts";

const SMALL: PiModel = fakeModel("fake", "small", { contextWindow: 32000 });
const BIG: PiModel = fakeModel("fake", "big", { contextWindow: 128000 });

const SETTINGS: RoutingSettings = { defaultProvider: "fake", defaultModelId: "small" };
const RESERVE = 16384;
/** SMALL's threshold is 15616 and BIG's is 111616; 100000 sits between them. */
function bigSpan() {
	return [userMessage("x".repeat(100000 * 4))];
}

function harness(options: {
	available: PiModel[];
	authed?: string[];
	branch?: readonly SessionEntry[];
	/** The in-flight fact the gate hands the route. Absent means no gate is wired at all. */
	gateInFlight?: () => boolean;
	phase?: RoutePhase;
}) {
	const authed = new Set(options.authed ?? ["fake"]);
	const ctx = {
		ui: { notify: () => {} },
		modelRegistry: {
			getAvailable: () => [...options.available],
			find: (provider: string, modelId: string) =>
				options.available.find((model) => model.provider === provider && model.id === modelId),
			hasConfiguredAuth: (model: PiModel) => authed.has(model.provider),
		},
		sessionManager: {
			getBranch: () => [...(options.branch ?? [])],
		},
	} as unknown as ExtensionContext;

	let resolved = 0;
	const decisions: RouteDecision[] = [];
	const route = createRoutingRoute({
		phase: options.phase ?? { current: () => "normal" },
		readSettings: () => SETTINGS,
		guard: createNotificationGuard(),
		onResolved: () => {
			resolved += 1;
		},
		onRoute: (decision) => decisions.push(decision),
		...(options.gateInFlight ? { gateInFlight: options.gateInFlight } : {}),
		readCompaction: () => ({ enabled: true, reserveTokens: RESERVE, keepRecentTokens: 20000 }),
	});
	const request = (overrides: Partial<ModelRouteRequest> = {}): ModelRouteRequest => ({
		model: fakeModel("spirits", "auto"),
		thinkingLevel: "medium",
		reason: "user",
		messages: [],
		...overrides,
	});
	return {
		route: (overrides: Partial<ModelRouteRequest> = {}) => route(request(overrides), ctx),
		decisions,
		resolvedCount: () => resolved,
	};
}

// spec "dual-model-routing / 先行圧縮の要約先の解決": 判別できないリクエストは従来どおり
test("no gate summary resolution when the gate is not running", () => {
	// A route wired without the gate reads at all: the rule cannot fire.
	const plain = harness({ available: [SMALL, BIG] });
	expect(plain.route({ reason: "direct", messages: bigSpan() }).model).toEqual(SMALL);
	expect(plain.decisions.length).toBe(1);

	// A route wired with the gate, flag down: the same answer through the same code path.
	let inFlight = false;
	const wired = harness({ available: [SMALL, BIG], gateInFlight: () => inFlight });
	expect(wired.route({ reason: "direct", messages: bigSpan() }).model).toEqual(SMALL);
	expect(wired.decisions.length).toBe(1);
	inFlight = true;
	// In flight but the span fits the role target: still the role target, still reported.
	expect(wired.route({ reason: "direct", messages: [userMessage("short")] }).model).toEqual(SMALL);
	expect(wired.decisions.length).toBe(2);
});

// spec scenario "振り分け先より大きい会話の要約"
test("a gate summary takes the previous model when the role target cannot hold the span", () => {
	const route = harness({ available: [SMALL, BIG], gateInFlight: () => true });

	const result = route.route({ reason: "direct", messages: bigSpan(), previous: { model: BIG, thinkingLevel: "medium" } });

	expect(result.model).toEqual(BIG);
	// The moved request reports nothing: no resolution for the phase, no request for `status`.
	expect(route.decisions).toEqual([]);
	expect(route.resolvedCount()).toBe(0);
});

// spec scenario "収容できるモデルが無い"
test("a gate summary keeps the role target when nothing else can hold it", () => {
	// The branch has no successful response, and a `previous` from an unauthenticated provider is
	// re-checked against the catalog: nothing can hold the span, so the role target answers as before.
	const routeNoAuth = harness({ available: [SMALL, BIG], authed: [], gateInFlight: () => true });
	const routeNoBranch = harness({ available: [SMALL, BIG], gateInFlight: () => true });

	expect(routeNoAuth.route({ reason: "direct", messages: bigSpan(), previous: { model: BIG } }).model).toEqual(SMALL);
	expect(routeNoBranch.route({ reason: "direct", messages: bigSpan() }).model).toEqual(SMALL);
});

test("other direct requests resolve as before", () => {
	// In flight, but this `direct` request's span fits the role target: a branch summary or an
	// extension call, not the gate's, and it reports like one.
	const route = harness({ available: [SMALL, BIG], gateInFlight: () => true });

	const result = route.route({ reason: "direct", messages: [userMessage("summarize the branch")] });

	expect(result.model).toEqual(SMALL);
	expect(route.decisions.length).toBe(1);
});

// spec "dual-model-routing / 先行圧縮の要約先の解決": only the gate's summary moves; a conversation
// request the user asked for keeps its role target even while the flag is up.
test("a conversation request keeps its role target while the gate is in flight", () => {
	const route = harness({ available: [SMALL, BIG], gateInFlight: () => true });

	expect(route.route({ reason: "user", messages: bigSpan() }).model).toEqual(SMALL);
	expect(route.decisions.length).toBe(1);
});

// task 3.4: the summary runs on the model that held the conversation — here the branch's latest
// successful response, which is the candidate pi itself would have named as `previous`.
test("the summary request runs on the model that held the conversation", () => {
	const route = harness({
		available: [SMALL, BIG],
		gateInFlight: () => true,
		// The last successful answer came from BIG: it demonstrably held this conversation.
		branch: [makeAssistantEntry("fake", "big")],
	});

	const result = route.route({ reason: "direct", messages: bigSpan() });

	expect(result.model.id).toBe("big");
	expect(result.model.contextWindow).toBe(128000);
});

// A `previous` the catalog no longer lists is not a candidate; the walk continues to the branch.
test("a previous model off the catalog falls to the branch's latest successful model", () => {
	const gone = fakeModel("fake", "retired", { contextWindow: 128000 });
	const route = harness({
		available: [SMALL, BIG],
		gateInFlight: () => true,
		branch: [makeAssistantEntry("fake", "big")],
	});

	expect(route.route({ reason: "direct", messages: bigSpan(), previous: { model: gone } }).model).toEqual(BIG);
});

// The step's role is untouched by the moved request: the route never reports it and never resolves it.
test("a gate summary leaves the step phase alone", () => {
	const phase = createRoutingPhase({ listCommands: () => [slashCommandInfo("opsx-propose", "prompt")] });
	phase.handleInput("/opsx-propose fit-gate");
	const step = phase.step();
	expect(step?.name).toBe("opsx-propose");
	const route = harness({ available: [SMALL, BIG], gateInFlight: () => true, phase });

	route.route({ reason: "direct", messages: bigSpan(), previous: { model: BIG } });

	// `requestResolved` never fired, so the step still reads as a step whose run has not happened.
	expect(phase.step()).toEqual(step);
	// A later idle input drops a step that never resolved, exactly as an input whose run never started does.
	phase.handleInput("anything");
	expect(phase.step()).toBeUndefined();
});
