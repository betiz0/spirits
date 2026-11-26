/**
 * The shared fit measurement (fit-gate change, tasks 2.1 and 2.2).
 *
 * The drift guard of design Decision D2 lives here: the gate's rejection must read exactly like pi's
 * own `shouldCompact` with `enabled` pinned true, and a conversation inside the nominal window but
 * past the reserve-inclusive threshold must still read as over.
 */

import { expect, test } from "bun:test";
import { shouldCompact } from "@earendil-works/pi-coding-agent";
import { estimateConversationTokens, overFitThreshold, readFitCompaction, spanFits } from "../src/routing/fit.ts";
import { fakeModel, userMessage } from "./host/fake-pi.ts";

const SMALL = fakeModel("fake", "small", { contextWindow: 32000 });

/** A user message whose body is `tokens` tokens by pi's chars/4 estimate. */
function messageOfTokens(tokens: number) {
	return userMessage("x".repeat(tokens * 4));
}

test("over the target threshold is over", () => {
	// window 32000, reserve 16384 → threshold 15616; one token past it is over.
	expect(overFitThreshold(15617, 32000, 16384)).toBe(true);
});

test("under the target threshold is not", () => {
	expect(overFitThreshold(15616, 32000, 16384)).toBe(false);
	expect(overFitThreshold(1, 32000, 16384)).toBe(false);
});

test("the comparison agrees with the exported shouldCompact when compaction is enabled", () => {
	const estimates = [0, 1, 15615, 15616, 15617, 31999, 32000, 40000];
	const reserve = 16384;
	for (const estimate of estimates) {
		expect(overFitThreshold(estimate, 32000, reserve)).toBe(
			shouldCompact(estimate, 32000, { enabled: true, reserveTokens: reserve, keepRecentTokens: 20000 }),
		);
	}
});

test("over the threshold within the nominal window is over", () => {
	// 20000 tokens fit the 32000 window itself; the reserve still puts them past the threshold.
	expect(overFitThreshold(20000, 32000, 16384)).toBe(true);
});

test("a span that exceeds the window does not fit", () => {
	expect(spanFits(40000, 32000, 16384)).toBe(false);
	// Past the threshold is not fitting, even inside the nominal window.
	expect(spanFits(20000, 32000, 16384)).toBe(false);
});

test("a span within the window fits", () => {
	expect(spanFits(15616, 32000, 16384)).toBe(true);
	expect(spanFits(0, 32000, 16384)).toBe(true);
});

test("the estimate counts projection messages and the received text", () => {
	const messages = [messageOfTokens(100), messageOfTokens(50)];
	expect(estimateConversationTokens(messages)).toBe(150);
	// The text is the input line pi has not put on the branch yet, measured by the same chars/4 rule.
	expect(estimateConversationTokens(messages, "x".repeat(40))).toBe(160);
	expect(estimateConversationTokens(messages, "")).toBe(150);
});

test("the reserve reads from the model override, then the ordinary key, then the host default", () => {
	const settings = {
		compaction: {
			reserveTokens: 8000,
			keepRecentTokens: 6000,
			modelOverrides: { "fake/small": { reserveTokens: 1000, keepRecentTokens: 2000 } },
		},
	};
	expect(readFitCompaction(settings, SMALL)).toEqual({ enabled: true, reserveTokens: 1000, keepRecentTokens: 2000 });

	const ordinary = { compaction: { reserveTokens: 8000, keepRecentTokens: 6000 } };
	expect(readFitCompaction(ordinary, SMALL)).toEqual({ enabled: true, reserveTokens: 8000, keepRecentTokens: 6000 });

	// No numbers anywhere: the host's exported default, not a spirits-side one.
	expect(readFitCompaction({}, SMALL).reserveTokens).toBe(16384);
	// A value pi would reject reads as unset, so the gate cannot invent a threshold from it.
	expect(readFitCompaction({ compaction: { reserveTokens: -1 } }, SMALL).reserveTokens).toBe(16384);
	expect(readFitCompaction({ compaction: { reserveTokens: 1.5 } }, SMALL).reserveTokens).toBe(16384);
});

test("the enabled reading only reads the boolean false as off", () => {
	expect(readFitCompaction({ compaction: { enabled: false } }, SMALL).enabled).toBe(false);
	expect(readFitCompaction({ compaction: { enabled: true } }, SMALL).enabled).toBe(true);
	expect(readFitCompaction({ compaction: {} }, SMALL).enabled).toBe(true);
});

// The estimate uses the host's over-counting heuristic, so a model's fit reads against the same
// numbers the gate's threshold check produces.
test("a conversation measured past a small window's threshold is over it", () => {
	const estimate = estimateConversationTokens([messageOfTokens(12000)], "x".repeat(4 * 5000));
	expect(estimate).toBe(17000);
	expect(overFitThreshold(estimate, SMALL.contextWindow, 16384)).toBe(true);
});
