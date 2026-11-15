import { expect, test } from "bun:test";
import type { CustomEntry, SessionProjection, SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import type { ReadonlySessionManager } from "../src/types/host.ts";
import { assistantMessage, customEntry, fakeProjection, fakeSessionManager, messageEntry, userMessage } from "./host/fake-pi.ts";
import { createGoalHostFn } from "../src/harness/goal.ts";
import type { HostFnEntry } from "../src/repl/registry.ts";
import { makeScope } from "./support.ts";

class FakePi {
	readonly entries: Array<{ customType: string; data: unknown }> = [];

	appendEntry(customType: string, data?: unknown): void {
		this.entries.push({ customType, data });
	}
}

/**
 * A session branch, handed over as the reader a context carries.
 *
 * The test reads a branch and its projection; pi's reader also owns persistence and navigation, which
 * no goal lookup touches.
 */
class FakeBranch {
	readonly #branch: readonly SessionEntry[];
	readonly #all: readonly SessionEntry[];

	constructor(branch: readonly SessionEntry[], all: readonly SessionEntry[] = branch) {
		this.#branch = branch;
		this.#all = all;
	}

	getBranch(): readonly SessionEntry[] {
		return this.#branch;
	}

	getEntries(): readonly SessionEntry[] {
		return this.#all;
	}

	buildSessionProjection(): SessionProjection {
		return fakeProjection({
			entries: this.#branch.map((entry) => ({
				sourceEntry: entry,
				messages: entry.type === "message" ? [entry.message] : [],
			})),
		});
	}
}

/** A session reader over the given branch. */
function fakeSessionFor(branch: readonly SessionEntry[], all: readonly SessionEntry[] = branch): ReadonlySessionManager {
	return fakeSessionManager(new FakeBranch(branch, all));
}

/** Ids for the entries a test builds, so two entries on one branch stay distinguishable. */
let entrySequence = 0;
function nextEntryId(): string {
	entrySequence += 1;
	return `entry-${entrySequence}`;
}

function userEntry(text: string): SessionMessageEntry {
	return messageEntry(userMessage(text), nextEntryId());
}

function assistantEntry(text: string): SessionMessageEntry {
	return messageEntry(
		assistantMessage(text),
		nextEntryId(),
	);
}

function goalEntry(goal: string): CustomEntry {
	return customEntry("spirits_goal", { goal }, nextEntryId());
}

function callGoal(entry: HostFnEntry, sessionManager: ReadonlySessionManager, ...args: unknown[]): unknown {
	const fn = entry.create(makeScope({ sessionManager }).scope);
	return fn(...args);
}

const NO_PI = new FakePi();

test("goal returns first user message", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const session = fakeSessionFor([userEntry("fix the parser")]);
	expect(callGoal(entry, session)).toBe("fix the parser");
});

test("goal skips non-user messages", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const session = fakeSessionFor([assistantEntry("working"), userEntry("fix the parser")]);
	expect(callGoal(entry, session)).toBe("fix the parser");
});

test("goal reads user message text parts", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const message: SessionMessageEntry = messageEntry(
		userMessage("", { content: [{ type: "text", text: "fix " }, { type: "text", text: "the parser" }] }),
		nextEntryId(),
	);
	expect(callGoal(entry, fakeSessionFor([message]))).toBe("fix the parser");
});

test("goal prefers explicit entry", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const session = fakeSessionFor([userEntry("original"), goalEntry("ship M4")]);
	expect(callGoal(entry, session)).toBe("ship M4");
});

test("goal uses latest explicit entry", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const session = fakeSessionFor([goalEntry("first"), goalEntry("second")]);
	expect(callGoal(entry, session)).toBe("second");
});

test("goal ignores other branches", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const branchA: SessionEntry[] = [userEntry("root"), goalEntry("goal-on-a")];
	const branchB: SessionEntry[] = [userEntry("root"), userEntry("branch-b")];
	const session = fakeSessionFor(branchB, [...branchA, ...branchB]);
	const goal = callGoal(entry, session);
	expect(goal).not.toBe("goal-on-a");
	expect(goal).toBe("root");
});

test("goal returns empty without messages", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	expect(callGoal(entry, fakeSessionFor([]))).toBe("");
});

test("goal set appends entry and returns text", () => {
	const pi = new FakePi();
	const entry = createGoalHostFn({ pi });
	expect(callGoal(entry, fakeSessionFor([]), "ship M4")).toBe("ship M4");
	expect(pi.entries.length).toBe(1);
	expect(pi.entries[0].customType).toBe("spirits_goal");
	expect(pi.entries[0].data).toEqual({ goal: "ship M4" });
});

test("goal set rejects blank", () => {
	const pi = new FakePi();
	const entry = createGoalHostFn({ pi });
	expect(() => callGoal(entry, fakeSessionFor([]), "   ")).toThrow();
	expect(pi.entries.length).toBe(0);
});

test("goal set rejects non-string", () => {
	const pi = new FakePi();
	const entry = createGoalHostFn({ pi });
	expect(() => callGoal(entry, fakeSessionFor([]), 42)).toThrow();
	expect(pi.entries.length).toBe(0);
});

test("goal set rejects undefined", () => {
	const pi = new FakePi();
	const entry = createGoalHostFn({ pi });
	const session = fakeSessionFor([userEntry("original")]);
	expect(() => callGoal(entry, session, undefined)).toThrow();
	expect(pi.entries.length).toBe(0);
});

test("goal with no argument is a getter", () => {
	const pi = new FakePi();
	const entry = createGoalHostFn({ pi });
	const session = fakeSessionFor([userEntry("original")]);
	expect(callGoal(entry, session)).toBe("original");
	expect(pi.entries.length).toBe(0);
});

test("goal does not skip empty first user message", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const imageOnly: SessionMessageEntry = messageEntry(
		userMessage("", { content: [{ type: "image", data: "x", mimeType: "image/png" }] }),
		nextEntryId(),
	);
	const session = fakeSessionFor([imageOnly, userEntry("second message")]);
	expect(callGoal(entry, session)).toBe("");
});
