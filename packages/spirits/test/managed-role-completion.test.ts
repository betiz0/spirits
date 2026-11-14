/**
 * The argument completion of `/spirits-role`.
 *
 * pi gives a completion function nothing but the argument prefix — no context, so no model catalog —
 * and it renders `label` and re-reads `value`. Both facts shape this surface and both are checked here
 * (spec `managed-commands` / 入力の補完は語彙を限定する, design Decision 8).
 */

import { expect, test } from "bun:test";
import type { AutocompleteItem } from "@earendil-works/pi-coding-agent";
import { MODEL_ROLES, STEP_DEFINITIONS, THINKING_LEVELS } from "../src/constants.ts";
import { roleCompletions } from "../src/commands/register.ts";

function values(items: AutocompleteItem[] | null): string[] {
	return (items ?? []).map((item) => item.value);
}

test("offers the vocabulary of the first word", () => {
	const first = values(roleCompletions(""));
	expect(first).toContain("status");
	for (const role of MODEL_ROLES) expect(first).toContain(role);
	for (const step of STEP_DEFINITIONS) expect(first).toContain(step.name);
});

test("offers the item names of the second word", () => {
	// A role owns `model` and `thinking`; a step owns `role` and `thinking`.
	expect(values(roleCompletions("strong "))).toEqual(["model", "thinking"]);
	expect(values(roleCompletions("opsx-propose "))).toEqual(["role", "thinking"]);
	// A prefix narrows rather than replaces.
	expect(values(roleCompletions("opsx-propose ro"))).toEqual(["role"]);
});

test("offers the value words of the third word", () => {
	expect(values(roleCompletions("opsx-propose role "))).toEqual([...MODEL_ROLES, "unset"]);
	expect(values(roleCompletions("opsx-propose thinking "))).toEqual([...THINKING_LEVELS, "unset"]);
	expect(values(roleCompletions("strong thinking "))).toEqual([...THINKING_LEVELS, "unset"]);
});

// spec scenario "モデル参照は補完しない": the catalog is not reachable from a completion, and a partial
// reference would be resolved by pi's fuzzy matcher on the way back, which spirits does not want.
test("offers no model candidates", () => {
	for (const prefix of ["strong model ", "normal model clau", "strong model compat"]) {
		expect(roleCompletions(prefix)).toBeNull();
	}
});

// pi's `applyCompletion` writes `item.label` into the editor and throws when it is missing, so a
// candidate that carries only a value is a crash waiting for a keystroke.
test("every completion item carries a label", () => {
	const prefixes = ["", "s", "status", "strong ", "strong model ", "strong thinking ", "opsx-propose ", "opsx-propose role ", "opsx-propose thinking "];
	for (const prefix of prefixes) {
		for (const item of roleCompletions(prefix) ?? []) {
			expect(typeof item.label).toBe("string");
			expect(item.label.length).toBeGreaterThan(0);
			// The value is what the caller matches on, so the two must agree.
			expect(item.value).toBe(item.label);
		}
	}
});

test("offers nothing where the grammar has no more words", () => {
	expect(roleCompletions("status ")).toBeNull();
	expect(roleCompletions("strong model x y ")).toBeNull();
	expect(roleCompletions("teleport ")).toBeNull();
	// A completed value with the space typed after it is still a completed value: the grammar has no fourth
	// word, so offering the third one again would invite a word the command cannot read.
	expect(roleCompletions("normal thinking high ")).toBeNull();
	expect(roleCompletions("opsx-propose role strong ")).toBeNull();
});
