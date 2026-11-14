/**
 * Pins the pi half of the child-model resolution (`fix-managed-rlm-child-model` design Decision 3):
 * the physical model spirits reads off the session branch for a child of an `spirits/auto` parent is
 * the model of the message pi itself picks as the latest successful response.
 *
 * pi derives a route request's `previous` with `findLatestResponse`, and an extension cannot call
 * it, so the child path walks `sessionManager.getBranch()` on its own. If the first test fails, pi
 * stopped recording the answering model on the message entry: the child resolution then finds no
 * previous response and refuses to start a child whose default model is gone. If the second fails,
 * pi's rule for "successful" changed (for example it stopped skipping `aborted`), and the child would
 * be handed a different model than the next request of the same session.
 */

import { expect, test } from "bun:test";
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { findLatestResponse } from "@earendil-works/pi-coding-agent/core/virtual-models";
import { createChildModelResolver } from "../../src/routing/child.ts";
import { createRoutingPhase } from "../../src/routing/phase.ts";
import type { RoutingSettings } from "../../src/config.ts";
import { AUTO_SELECTION, fakeToolContext } from "../routing/fake-pi.ts";

const SONNET = { provider: "anthropic", id: "claude-sonnet-4-5" };
const OPUS = { provider: "anthropic", id: "claude-opus-4-7" };
const LUNA = { provider: "openai", id: "gpt-5.6-luna" };

/** Settings with no default model: the resolution has to reach the branch, or fail. */
const NO_DEFAULT: RoutingSettings = {};

/** A response pi would have written, named by the model that answered and how it ended. */
interface Response {
	provider: string;
	model: string;
	stopReason: string;
}

/** Resolve the child model the way `rlm` does, through the injected resolver. */
function childModel(branch: readonly SessionEntry[]): string {
	const { ctx } = fakeToolContext({
		available: [SONNET, OPUS, LUNA],
		authedProviders: ["anthropic", "openai"],
		branch,
	});
	const resolve = createChildModelResolver({
		phase: createRoutingPhase(),
		readSettings: () => NO_DEFAULT,
	});
	// The resolver hands back a target; the pin is about which model it names, not the level.
	const { model } = resolve(AUTO_SELECTION, ctx);
	return `${model.provider}/${model.id}`;
}

/** The messages pi would hand `findLatestResponse`: the branch's message entries, in order. */
function messagesOf(branch: readonly SessionEntry[]): unknown[] {
	return branch.filter((entry) => entry.type === "message").map((entry) => entry.message);
}

/** The same branch pi carries while a session runs: an asked message, then the responses. */
function branchWith(responses: readonly Response[]): readonly SessionEntry[] {
	const sessionManager = SessionManager.inMemory();
	sessionManager.appendMessage({ role: "user", content: "asked" });
	for (const response of responses) {
		sessionManager.appendMessage({
			role: "assistant",
			content: [],
			provider: response.provider,
			model: response.model,
			stopReason: response.stopReason,
		});
	}
	return sessionManager.getBranch();
}

/** `provider/id` of pi's own latest successful response, or undefined when it has none. */
function latestOf(messages: readonly unknown[]): string | undefined {
	const latest = findLatestResponse(messages);
	return latest === undefined ? undefined : `${latest.provider}/${latest.model}`;
}

test("pi records the answering model and stop reason on the entry spirits reads", () => {
	const branch = branchWith([{ provider: "anthropic", model: "claude-sonnet-4-5", stopReason: "stop" }]);
	const assistant = messagesOf(branch).at(-1) as { provider?: string; model?: string; stopReason?: string };

	// The child resolution reads these three fields off the entry, and nothing else.
	expect(assistant.provider).toBe("anthropic");
	expect(assistant.model).toBe("claude-sonnet-4-5");
	expect(assistant.stopReason).toBe("stop");
});

test("the child resolution picks the model pi picks as the latest successful response", () => {
	const branches: Response[][] = [
		[{ provider: "anthropic", model: "claude-sonnet-4-5", stopReason: "stop" }],
		[
			{ provider: "anthropic", model: "claude-sonnet-4-5", stopReason: "stop" },
			{ provider: "openai", model: "gpt-5.6-luna", stopReason: "stop" },
		],
		// The newest response failed: pi walks back past it, and so does the child resolution.
		[
			{ provider: "anthropic", model: "claude-opus-4-7", stopReason: "stop" },
			{ provider: "openai", model: "gpt-5.6-luna", stopReason: "error" },
		],
		[
			{ provider: "anthropic", model: "claude-opus-4-7", stopReason: "stop" },
			{ provider: "openai", model: "gpt-5.6-luna", stopReason: "aborted" },
		],
		[
			{ provider: "anthropic", model: "claude-sonnet-4-5", stopReason: "stop" },
			{ provider: "anthropic", model: "claude-opus-4-7", stopReason: "error" },
			{ provider: "openai", model: "gpt-5.6-luna", stopReason: "aborted" },
		],
	];

	for (const responses of branches) {
		const branch = branchWith(responses);
		const latest = latestOf(messagesOf(branch));
		if (latest === undefined) {
			throw new Error(`pi reported no latest response for ${JSON.stringify(responses)}`);
		}
		expect(childModel(branch)).toBe(latest);
	}
});

// The other half of the same rule: with no successful response there is nothing to inherit, and the
// resolution refuses instead of guessing.
test("neither pi nor the child resolution finds a model without a successful response", () => {
	const branch = branchWith([{ provider: "openai", model: "gpt-5.6-luna", stopReason: "aborted" }]);

	expect(findLatestResponse(messagesOf(branch))).toBeUndefined();
	expect(() => childModel(branch)).toThrow("no successful response");
});
