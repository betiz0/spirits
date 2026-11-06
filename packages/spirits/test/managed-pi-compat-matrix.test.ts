import { expect, test } from "bun:test";
import {
	clearPurposeObservations,
	deriveRows,
	matrixRows,
	modelPurposeObservations,
	observePurpose,
	purposesFor,
	rolePurposeObservations,
	validateMatrix,
} from "../../../scripts/managed-pi-compat/matrix.ts";

const STRONG_ATTEMPT = {
	attempted: true,
	normalRequestModel: "fake-model",
	strongRequestModel: "fake-strong",
	expectedNormalModel: "fake-model",
	expectedStrongModel: "fake-strong",
};

test("role items are classified separately", () => {
	const rows = matrixRows("role");
	expect(rows).toHaveLength(3);
	// Without an observation no row carries a state, so no static table decides the matrix.
	expect(rows.every((row) => row.state === "not-run" && row.observed === false)).toBe(true);
	const observed = matrixRows("role", rolePurposeObservations(STRONG_ATTEMPT));
	expect(observed.map((row) => row.state)).toEqual(["available", "not-run", "not-run"]);
	expect(new Set(observed.map((row) => row.purpose)).size).toBe(3);
});

test("clear items include the session-id difference", () => {
	const row = matrixRows("clear")[0]!;
	expect(row.purpose).toContain("Remove conversation");
	expect(purposesFor("clear").some((purpose) => purpose.difference?.includes("would change the ID"))).toBe(true);
});

test("model items separate level from role", () => {
	const rows = matrixRows("model");
	expect(rows[0]?.purpose).toContain("thinking level");
	expect(rows[1]?.purpose).toContain("role");
});

test("role purposes are observed separately", () => {
	const purposes = purposesFor("role");
	expect(purposes).toHaveLength(3);
	const observations = purposes.map((purpose, index) =>
		observePurpose("role", purpose.id, {
			observed: true,
			state: index === 0 ? "limited" : "unavailable",
		}),
	);
	expect(observations.map((observation) => observation.purposeId)).toEqual([
		"skill-strong-phase",
		"model-role-vocabulary",
		"role-badge",
	]);
	expect(observations.map((observation) => observation.state)).toEqual(["limited", "unavailable", "unavailable"]);
	expect(new Set(observations.map((observation) => observation.purpose)).size).toBe(3);
});

test("clear purposes are observed separately", () => {
	const purposes = purposesFor("clear");
	expect(purposes).toHaveLength(3);
	const observations = purposes.map((purpose) =>
		observePurpose("clear", purpose.id, { observed: true, state: "unavailable" }),
	);
	expect(observations.map((observation) => observation.purposeId)).toEqual([
		"conversation-clear",
		"same-session-id",
		"todo-retention",
	]);
	expect(new Set(observations.map((observation) => observation.purpose)).size).toBe(3);
});

test("model purposes are observed separately", () => {
	const purposes = purposesFor("model");
	expect(purposes).toHaveLength(3);
	const observations = purposes.map((purpose, index) =>
		observePurpose("model", purpose.id, {
			observed: true,
			state: index === 0 ? "limited" : "unavailable",
		}),
	);
	expect(observations.map((observation) => observation.purposeId)).toEqual([
		"thinking-level",
		"role-selection",
		"default-save",
	]);
	expect(observations.map((observation) => observation.state)).toEqual(["limited", "unavailable", "unavailable"]);
});

test("command list absence does not decide unavailability", () => {
	const observation = observePurpose("role", "model-role-vocabulary", {
		observed: false,
		detail: "the command list has no model command",
	});
	expect(observation.state).toBe("not-run");
	expect(observation.state).not.toBe("unavailable");
});

test("clear purposes come from observations", () => {
	const before = { sessionId: "s-1", messageEntries: 6, todoEntries: 1 };
	// Nothing observed: every purpose is `not-run`, never `unavailable`.
	const unattempted = clearPurposeObservations({ attempted: false, reason: "the RPC surface cannot drive /clear" });
	expect(unattempted.map((observation) => observation.state)).toEqual(["not-run", "not-run", "not-run"]);
	expect(unattempted[0]?.detail).toContain("cannot drive /clear");
	// A prompt that left the conversation in place exercised nothing.
	const untouched = clearPurposeObservations({
		attempted: true,
		before,
		after: { ...before },
	});
	expect(untouched.every((observation) => observation.state === "not-run")).toBe(true);
	// A host that answers /clear as an ordinary prompt grows the conversation. That is still no
	// evidence about the clear purpose, and the reason states what was counted.
	const grew = clearPurposeObservations({
		attempted: true,
		before,
		after: { sessionId: "s-1", messageEntries: 8, todoEntries: 1 },
	});
	expect(grew.every((observation) => observation.state === "not-run")).toBe(true);
	expect(grew[0]?.detail).toContain("grew from 6 to 8");
	// A conversation that shrank decides all three purposes from what came back.
	const cleared = clearPurposeObservations({
		attempted: true,
		before,
		after: { sessionId: "s-1", messageEntries: 0, todoEntries: 1 },
	});
	expect(cleared.map((observation) => observation.state)).toEqual(["available", "available", "available"]);
	const newSession = clearPurposeObservations({
		attempted: true,
		before,
		after: { sessionId: "s-2", messageEntries: 0, todoEntries: 0 },
	});
	expect(newSession.map((observation) => observation.state)).toEqual(["available", "unavailable", "unavailable"]);
});

test("model default save is read back", () => {
	const saved = modelPurposeObservations({ attempted: true, levelChanged: true, defaultsChanged: true });
	const defaultSave = saved.find((observation) => observation.purposeId === "default-save");
	expect(defaultSave?.state).toBe("available");
	// The runtime selection left the default keys untouched, so no save path was exercised.
	const unsaved = modelPurposeObservations({ attempted: true, levelChanged: true, defaultsChanged: false });
	const unsavedDefault = unsaved.find((observation) => observation.purposeId === "default-save");
	expect(unsavedDefault?.state).toBe("not-run");
	expect(unsavedDefault?.detail).toContain("read back unchanged");
	// The level was observed through the session runtime, not the `/model` line.
	const level = unsaved.find((observation) => observation.purposeId === "thinking-level");
	expect(level?.state).toBe("limited");
	expect(level?.detail).toContain("session runtime");
	// A role vocabulary needs a surface that takes a role argument; nothing observed is `not-run`.
	expect(unsaved.find((observation) => observation.purposeId === "role-selection")?.state).toBe("not-run");
});

test("role purposes come from the model that served the request", () => {
	const routed = rolePurposeObservations(STRONG_ATTEMPT);
	expect(routed.find((observation) => observation.purposeId === "skill-strong-phase")?.state).toBe("available");
	const notRouted = rolePurposeObservations({ ...STRONG_ATTEMPT, strongRequestModel: "fake-model" });
	expect(notRouted.find((observation) => observation.purposeId === "skill-strong-phase")?.state).toBe("limited");
	const noRequest = rolePurposeObservations({ ...STRONG_ATTEMPT, strongRequestModel: undefined });
	expect(noRequest.find((observation) => observation.purposeId === "skill-strong-phase")?.state).toBe("not-run");
	// The badge is a terminal surface; absence of an API says nothing about it.
	expect(routed.find((observation) => observation.purposeId === "role-badge")?.state).toBe("not-run");
});

test("rows are derived from purpose observations", () => {
	const observations = [...rolePurposeObservations(STRONG_ATTEMPT), ...clearPurposeObservations({ attempted: false })];
	const rows = deriveRows(observations);
	expect(rows).toHaveLength(9);
	for (const row of rows) {
		const observation = observations.find((entry) => entry.feature === row.feature && entry.purposeId === row.id);
		// A row never disagrees with its purpose observation, and never carries a state on its own.
		expect(row.state).toBe(observation?.state ?? "not-run");
		expect(row.purpose).toBe(observation?.purpose ?? row.purpose);
	}
	expect(rows.filter((row) => row.state === "not-run")).toHaveLength(8);
	validateMatrix(rows);
});

test("matrix validation requires alternatives for unavailable rows", () => {
	expect(() => validateMatrix(deriveRows([]))).not.toThrow();
	const rows = deriveRows([]).map((row) => (row.feature === "clear" ? { ...row, state: "unavailable" as const } : row));
	expect(() => validateMatrix(rows)).not.toThrow();
	const stripped = rows.map((row) => (row.feature === "clear" ? { ...row, alternative: undefined } : row));
	expect(() => validateMatrix(stripped)).toThrow();
});
