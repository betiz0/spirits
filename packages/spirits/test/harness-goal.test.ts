import { expect, test } from "bun:test";
import type {
	CustomEntry,
	ReadonlySessionManager,
	SessionEntry,
	SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { createGoalHostFn } from "../src/harness/goal.ts";
import type { HostFnEntry } from "../src/repl/registry.ts";
import { makeScope } from "./support.ts";

class FakePi {
	readonly entries: Array<{ customType: string; data: unknown }> = [];

	appendEntry(customType: string, data?: unknown): void {
		this.entries.push({ customType, data });
	}
}

class FakeSessionManager {
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
}

function userEntry(text: string): SessionMessageEntry {
	return { type: "message", message: { role: "user", content: text } };
}

function assistantEntry(text: string): SessionMessageEntry {
	return { type: "message", message: { role: "assistant", content: [{ type: "text", text }] } };
}

function goalEntry(goal: string): CustomEntry {
	return { type: "custom", customType: "spirits_goal", data: { goal } };
}

function callGoal(entry: HostFnEntry, sessionManager: ReadonlySessionManager, ...args: unknown[]): unknown {
	const fn = entry.create(makeScope({ sessionManager }).scope);
	return fn(...args);
}

const NO_PI = new FakePi();

test("goal returns first user message", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const session = new FakeSessionManager([userEntry("fix the parser")]);
	expect(callGoal(entry, session)).toBe("fix the parser");
});

test("goal skips non-user messages", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const session = new FakeSessionManager([assistantEntry("working"), userEntry("fix the parser")]);
	expect(callGoal(entry, session)).toBe("fix the parser");
});

test("goal reads user message text parts", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const message: SessionMessageEntry = {
		type: "message",
		message: {
			role: "user",
			content: [
				{ type: "text", text: "fix " },
				{ type: "text", text: "the parser" },
			],
		},
	};
	expect(callGoal(entry, new FakeSessionManager([message]))).toBe("fix the parser");
});

test("goal prefers explicit entry", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const session = new FakeSessionManager([userEntry("original"), goalEntry("ship M4")]);
	expect(callGoal(entry, session)).toBe("ship M4");
});

test("goal uses latest explicit entry", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const session = new FakeSessionManager([goalEntry("first"), goalEntry("second")]);
	expect(callGoal(entry, session)).toBe("second");
});

test("goal ignores other branches", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const branchA: SessionEntry[] = [userEntry("root"), goalEntry("goal-on-a")];
	const branchB: SessionEntry[] = [userEntry("root"), userEntry("branch-b")];
	const session = new FakeSessionManager(branchB, [...branchA, ...branchB]);
	const goal = callGoal(entry, session);
	expect(goal).not.toBe("goal-on-a");
	expect(goal).toBe("root");
});

test("goal returns empty without messages", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	expect(callGoal(entry, new FakeSessionManager([]))).toBe("");
});

test("goal set appends entry and returns text", () => {
	const pi = new FakePi();
	const entry = createGoalHostFn({ pi });
	expect(callGoal(entry, new FakeSessionManager([]), "ship M4")).toBe("ship M4");
	expect(pi.entries.length).toBe(1);
	expect(pi.entries[0].customType).toBe("spirits_goal");
	expect(pi.entries[0].data).toEqual({ goal: "ship M4" });
});

test("goal set rejects blank", () => {
	const pi = new FakePi();
	const entry = createGoalHostFn({ pi });
	expect(() => callGoal(entry, new FakeSessionManager([]), "   ")).toThrow();
	expect(pi.entries.length).toBe(0);
});

test("goal set rejects non-string", () => {
	const pi = new FakePi();
	const entry = createGoalHostFn({ pi });
	expect(() => callGoal(entry, new FakeSessionManager([]), 42)).toThrow();
	expect(pi.entries.length).toBe(0);
});

test("goal set rejects undefined", () => {
	const pi = new FakePi();
	const entry = createGoalHostFn({ pi });
	const session = new FakeSessionManager([userEntry("original")]);
	expect(() => callGoal(entry, session, undefined)).toThrow();
	expect(pi.entries.length).toBe(0);
});

test("goal with no argument is a getter", () => {
	const pi = new FakePi();
	const entry = createGoalHostFn({ pi });
	const session = new FakeSessionManager([userEntry("original")]);
	expect(callGoal(entry, session)).toBe("original");
	expect(pi.entries.length).toBe(0);
});

test("goal does not skip empty first user message", () => {
	const entry = createGoalHostFn({ pi: NO_PI });
	const imageOnly: SessionMessageEntry = {
		type: "message",
		message: { role: "user", content: [{ type: "image", data: "x", mimeType: "image/png" }] },
	};
	const session = new FakeSessionManager([imageOnly, userEntry("second message")]);
	expect(callGoal(entry, session)).toBe("");
});
