/**
 * The openspec CLI readers: change-root resolution and the exact change-name list.
 *
 * Every failure shape the CLI can produce has to come back as a reason, not a write and not a
 * throw (spec `verification-report-saving` / 保存の受理と応答). The runner is the injected seam of
 * design Decision 13, so the shapes are handed over directly; the store flag pass-through is read
 * off the arguments the fake was called with.
 */

import { expect, test } from "bun:test";
import {
	OPENSPEC_CLI_TIMEOUT_REASON,
	OPENSPEC_CLI_UNAVAILABLE_REASON,
} from "../src/constants.ts";
import {
	createOpenspecChangeNameLister,
	createOpenspecChangeRootResolver,
	parseChangeNames,
	parseChangeRoot,
	type OpenspecRun,
	type OpenspecRunner,
} from "../src/verify/change-root.ts";

/** A runner that answers with one canned result and records every argument list. */
function recordingRunner(answer: OpenspecRun): { runner: OpenspecRunner; calls: string[][] } {
	const calls: string[][] = [];
	return {
		calls,
		runner: async (args) => {
			calls.push([...args]);
			return answer;
		},
	};
}

test("status resolves changeRoot and passes --store only when one is named", async () => {
	const { runner, calls } = recordingRunner({
		kind: "output",
		stdout: JSON.stringify({ changeName: "alpha", changeRoot: "/plan/changes/alpha" }),
	});
	const resolve = createOpenspecChangeRootResolver({ run: runner });

	expect(await resolve("alpha")).toEqual({ kind: "ok", changeRoot: "/plan/changes/alpha" });
	expect(calls[0]).toEqual(["status", "--change", "alpha", "--json"]);

	expect(await resolve("alpha", "store-1")).toEqual({ kind: "ok", changeRoot: "/plan/changes/alpha" });
	expect(calls[1]).toEqual(["status", "--change", "alpha", "--json", "--store", "store-1"]);
});

test("every CLI failure shape is a reason, not a write", async () => {
	const cases: Array<{ answer: OpenspecRun; expectText: string }> = [
		{ answer: { kind: "exit", code: 1, stderr: "change not found" }, expectText: "exit 1" },
		{ answer: { kind: "output", stdout: "not json" }, expectText: "readable JSON" },
		{ answer: { kind: "output", stdout: JSON.stringify({ changeName: "alpha" }) }, expectText: "changeRoot" },
		{ answer: { kind: "output", stdout: JSON.stringify({ changeRoot: "" }) }, expectText: "changeRoot" },
		{ answer: { kind: "timeout" }, expectText: OPENSPEC_CLI_TIMEOUT_REASON },
		{ answer: { kind: "unavailable" }, expectText: OPENSPEC_CLI_UNAVAILABLE_REASON },
	];
	for (const testCase of cases) {
		const resolve = createOpenspecChangeRootResolver({ run: recordingRunner(testCase.answer).runner });
		const result = await resolve("alpha");
		expect(result.kind).toBe("error");
		if (result.kind === "error") expect(result.reason).toContain(testCase.expectText);
	}
});

test("list reads exact change names, and an unreadable answer is no names", async () => {
	const { runner, calls } = recordingRunner({
		kind: "output",
		stdout: JSON.stringify({
			changes: [{ name: "alpha" }, { name: "beta" }, { note: "no name" }, "not an object"],
			root: { path: "/plan" },
		}),
	});
	const list = createOpenspecChangeNameLister({ run: runner });
	expect(await list()).toEqual(["alpha", "beta"]);
	expect(calls[0]).toEqual(["list", "--json"]);

	for (const answer of [
		{ kind: "exit", code: 1, stderr: "no store" },
		{ kind: "timeout" },
		{ kind: "unavailable" },
		{ kind: "output", stdout: "{" },
	] satisfies OpenspecRun[]) {
		const quiet = createOpenspecChangeNameLister({ run: recordingRunner(answer).runner });
		expect(await quiet()).toEqual([]);
	}
});

// d-verify3 C-1: the pin's name list has to come from the store the verification carries, or a
// change that lives only in that store can never pin while a local-only one wrongly can.
test("list passes --store when one is named, and answers from that store's changes", async () => {
	const storeChanges = JSON.stringify({ changes: [{ name: "in-store" }] });
	const localChanges = JSON.stringify({ changes: [{ name: "local-only" }] });
	const calls: string[][] = [];
	const list = createOpenspecChangeNameLister({
		run: async (args) => {
			calls.push([...args]);
			return { kind: "output", stdout: args.includes("--store") ? storeChanges : localChanges };
		},
	});

	expect(await list("store-1")).toEqual(["in-store"]);
	expect(calls[0]).toEqual(["list", "--json", "--store", "store-1"]);

	expect(await list()).toEqual(["local-only"]);
	expect(calls[1]).toEqual(["list", "--json"]);
});

test("the parsers stand on their own", () => {
	expect(parseChangeRoot('{"changeRoot":"/x"}')).toEqual({ kind: "ok", changeRoot: "/x" });
	expect(parseChangeRoot("[]").kind).toBe("error");
	expect(parseChangeNames('{"changes":[]}')).toEqual([]);
	expect(parseChangeNames("nope")).toEqual([]);
});
