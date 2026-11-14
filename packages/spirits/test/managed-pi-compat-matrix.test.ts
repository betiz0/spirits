import { expect, test } from "bun:test";
import {
	clearPurposeObservations,
	deriveRows,
	matrixRows,
	modelPurposeObservations,
	observePurpose,
	purposesFor,
	rolePurposeObservations,
	roleStatusObservation,
	validateMatrix,
	validatePurposeObservations,
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
	expect(rows).toHaveLength(5);
	// Without an observation no row carries a state, so no static table decides the matrix.
	expect(rows.every((row) => row.state === "not-run" && row.observed === false)).toBe(true);
	const observed = matrixRows("role", rolePurposeObservations(STRONG_ATTEMPT));
	expect(observed.map((row) => row.state)).toEqual(["available", "not-run", "not-run", "not-run", "not-run"]);
	expect(new Set(observed.map((row) => row.purpose)).size).toBe(5);
	// A step setting is its own row, and only a step request that changed the model can fill it.
	const withStep = matrixRows("role", rolePurposeObservations({ ...STRONG_ATTEMPT, stepSettingsApplied: true }));
	expect(withStep.find((row) => row.id === "step-role-settings")?.state).toBe("available");
});

test("clear items include the session-id difference", () => {
	const row = matrixRows("clear")[0]!;
	expect(row.purpose).toContain("Remove conversation");
	// The command must not turn into a new session, so the ID difference stays named.
	expect(purposesFor("clear").some((purpose) => purpose.difference?.includes("new session"))).toBe(true);
});

test("model items separate level from role", () => {
	const rows = matrixRows("model");
	expect(rows[0]?.purpose).toContain("thinking level");
	expect(rows[1]?.purpose).toContain("role");
});

test("role purposes are observed separately", () => {
	const purposes = purposesFor("role");
	expect(purposes).toHaveLength(5);
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
		"step-role-settings",
		"role-status-report",
	]);
	expect(observations.map((observation) => observation.state)).toEqual([
		"limited",
		"unavailable",
		"unavailable",
		"unavailable",
		"unavailable",
	]);
	expect(new Set(observations.map((observation) => observation.purpose)).size).toBe(5);
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
	expect(purposes).toHaveLength(5);
	const observations = purposes.map((purpose, index) =>
		observePurpose("model", purpose.id, {
			observed: true,
			state: index === 0 ? "limited" : "unavailable",
		}),
	);
	expect(observations.map((observation) => observation.purposeId)).toEqual([
		"thinking-level",
		"role-model",
		// The session's own selection sits between the two: a role's target and the model the session is on
		// are the two halves the routing deliberately pulls apart.
		"session-model-selection",
		"default-save",
		"settings-list",
	]);
	expect(observations.map((observation) => observation.state)).toEqual([
		"limited",
		"unavailable",
		"unavailable",
		"unavailable",
		"unavailable",
	]);
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
	const unattempted = clearPurposeObservations({ attempted: false, reason: "the RPC surface cannot drive the command" });
	expect(unattempted.map((observation) => observation.state)).toEqual(["not-run", "not-run", "not-run"]);
	expect(unattempted[0]?.detail).toContain("cannot drive the command");

	// The session file keeps its message entries by design, so a run that sent the command without a
	// request observation decides nothing about the conversation.
	const noRequest = clearPurposeObservations({ attempted: true, before, after: { ...before } });
	expect(noRequest.map((observation) => observation.state)).toEqual(["not-run", "available", "available"]);
	expect(noRequest[0]?.detail).toContain("request content");

	// What the model was shown is the measurement: the earlier turn is gone from the request.
	const cleared = clearPurposeObservations({
		attempted: true,
		before,
		after: { sessionId: "s-1", messageEntries: 7, todoEntries: 1 },
		context: { observed: true, cleared: true, detail: "the request after the command carried only the later turn" },
	});
	expect(cleared.map((observation) => observation.state)).toEqual(["available", "available", "available"]);

	// A command that left the conversation in the request is an observed failure, not a gap.
	const stuck = clearPurposeObservations({
		attempted: true,
		before,
		after: { sessionId: "s-1", messageEntries: 7, todoEntries: 1 },
		context: { observed: true, cleared: false, detail: "the request still carried the earlier turn" },
	});
	expect(stuck[0]?.state).toBe("unavailable");

	// A command that opened a new session loses the session ID and the TODO list with it.
	const newSession = clearPurposeObservations({
		attempted: true,
		before,
		after: { sessionId: "s-2", messageEntries: 0, todoEntries: 0 },
		context: { observed: true, cleared: true, detail: "nothing was in the request" },
	});
	expect(newSession.map((observation) => observation.state)).toEqual(["available", "unavailable", "unavailable"]);
});

// The two terminal-only purposes are `not-run` whatever the attempt says, because there is no RPC
// command that reaches them. Calling them `unavailable` would report a missing feature where only the
// measurement path is missing.
test("model default save and the settings list are never read as unavailable", () => {
	for (const attempt of [
		{ attempted: false },
		{ attempted: true, requestedLevel: "high", observedLevel: "high", roleModelSaved: true },
		{ attempted: true, reason: "the dedicated Pi refused the command" },
	]) {
		const observations = modelPurposeObservations(attempt);
		const defaultSave = observations.find((observation) => observation.purposeId === "default-save");
		const list = observations.find((observation) => observation.purposeId === "settings-list");
		expect(defaultSave?.state).toBe("not-run");
		expect(list?.state).toBe("not-run");
	}
	// The reason names what cannot be driven and the RPC operation that covers the same purpose.
	const observed = modelPurposeObservations({ attempted: true, requestedLevel: "high", observedLevel: "high" });
	expect(observed.find((observation) => observation.purposeId === "default-save")?.detail).toContain("set_model");
	expect(observed.find((observation) => observation.purposeId === "settings-list")?.detail).toContain("/spirits-role");
});

// spec `managed-pi-compatibility` / model の記録: `set_model` moves the model the session sits on, and a
// role's target is what a routed request answers with. The routing makes the two differ on purpose, so
// they are two rows, and neither row may borrow the other's evidence.
test("records the session model selection apart from the role target", () => {
	const both = modelPurposeObservations({
		attempted: true,
		requestedLevel: "high",
		observedLevel: "high",
		roleModelSaved: true,
		sessionSelection: { requested: "spirits/auto", readBack: "spirits/auto" },
	});
	const session = both.find((observation) => observation.purposeId === "session-model-selection");
	expect(session?.state).toBe("available");
	expect(session?.detail).toContain("set_model selected spirits/auto");
	expect(session?.detail).toContain("session's own choice");
	// The role row never claims the session moved, and the session row never claims a target was saved.
	expect(both.find((observation) => observation.purposeId === "role-model")?.detail).not.toContain("set_model");
	expect(session?.detail).not.toContain("models.");

	// A selection the session did not keep is a purpose that did not happen, not a partial one.
	expect(
		modelPurposeObservations({ attempted: true, sessionSelection: { requested: "spirits/auto", readBack: "other/model" } }).find(
			(observation) => observation.purposeId === "session-model-selection",
		)?.state,
	).toBe("unavailable");

	// No readback decides nothing, which is `not-run` rather than a missing feature, and the reason says
	// which of the two halves is missing.
	const unread = modelPurposeObservations({ attempted: true, requestedLevel: "high", observedLevel: "high" }).find(
		(observation) => observation.purposeId === "session-model-selection",
	);
	expect(unread?.state).toBe("not-run");
	expect(unread?.detail).toContain("reported no model");
});

// A thinking level is the level the provider received, and nothing else. A run that asked for one level
// and sent another is a purpose that did not happen.
test("the thinking level is the level the provider received", () => {
	const matched = modelPurposeObservations({ attempted: true, requestedLevel: "high", observedLevel: "high" });
	const level = matched.find((observation) => observation.purposeId === "thinking-level");
	expect(level?.state).toBe("available");
	expect(level?.detail).toContain("asked for high");
	expect(level?.detail).toContain("received high");

	const mismatched = modelPurposeObservations({ attempted: true, requestedLevel: "high", observedLevel: "low" });
	expect(mismatched.find((observation) => observation.purposeId === "thinking-level")?.state).toBe("unavailable");

	// No request that could carry a level decides nothing, which is `not-run` rather than a failure.
	expect(
		modelPurposeObservations({ attempted: true }).find((observation) => observation.purposeId === "thinking-level")
			?.state,
	).toBe("not-run");

	const roleModel = modelPurposeObservations({ attempted: true, roleModelSaved: true });
	expect(roleModel.find((observation) => observation.purposeId === "role-model")?.state).toBe("available");
	expect(
		modelPurposeObservations({ attempted: true }).find((observation) => observation.purposeId === "role-model")
			?.state,
	).toBe("not-run");
});

test("role purposes come from the model that served the request", () => {
	const routed = rolePurposeObservations(STRONG_ATTEMPT);
	expect(routed.find((observation) => observation.purposeId === "skill-strong-phase")?.state).toBe("available");
	// Routing to the plain model is the purpose not happening at all, so it is `unavailable`: a
	// `limited` row has to leave the user a working part, and here nothing routes.
	const notRouted = rolePurposeObservations({ ...STRONG_ATTEMPT, strongRequestModel: "fake-model" });
	expect(notRouted.find((observation) => observation.purposeId === "skill-strong-phase")?.state).toBe("unavailable");
	// Strong routed but the plain request followed it: the phases still run, only the difference a
	// user would see is gone, which is what `limited` is for.
	const bothStrong = rolePurposeObservations({ ...STRONG_ATTEMPT, normalRequestModel: "fake-strong" });
	const partial = bothStrong.find((observation) => observation.purposeId === "skill-strong-phase");
	expect(partial?.state).toBe("limited");
	expect(partial?.detail).toContain("not distinguishable by model");
	const noRequest = rolePurposeObservations({ ...STRONG_ATTEMPT, strongRequestModel: undefined });
	expect(noRequest.find((observation) => observation.purposeId === "skill-strong-phase")?.state).toBe("not-run");
	// The badge is a terminal surface; absence of an API says nothing about it.
	expect(routed.find((observation) => observation.purposeId === "role-badge")?.state).toBe("not-run");
});

// spec `managed-pi-compatibility` / role の記録: the report `/spirits-role status` shows is its own
// purpose, and its state comes from the text the dedicated Pi was asked to show — not from the command
// having run, and not from another row's evidence.
test("records the status report as a role purpose", () => {
	const report = [
		"routing: on (spirits/auto is selected)",
		"lock: normal",
		"step: opsx-apply (continuing) runs strong",
		"last request: strong on compat-fake/fake-strong at high",
		"normal: compat-fake/fake-model (settings)",
		"strong: compat-fake/fake-strong (settings)",
	].join("\n");
	expect(roleStatusObservation(report).state).toBe("available");
	expect(roleStatusObservation(report).detail).toContain("lock: normal");

	// A report that names no target is the command running without answering the purpose.
	const thin = roleStatusObservation("routing: on (spirits/auto is selected)");
	expect(thin.state).toBe("unavailable");
	expect(thin.detail).toContain("strong:");

	// Nothing to read is a gap in the harness, not a missing feature.
	for (const absent of [undefined, "", "   "]) {
		const gap = roleStatusObservation(absent);
		expect(gap.state).toBe("not-run");
		expect(gap.detail).toContain("never observed");
	}

	// The row goes through the same rule as every other observed row: an alternative has to travel with it.
	const observations = rolePurposeObservations({ ...STRONG_ATTEMPT, statusReport: report });
	const row = observations.find((observation) => observation.purposeId === "role-status-report")!;
	expect(row.state).toBe("available");
	expect(row.alternative).toContain("/spirits-role status");
	expect(() => validatePurposeObservations(observations)).not.toThrow();
	// Without a report the row is `not-run`, and no other row's evidence fills it in.
	expect(rolePurposeObservations(STRONG_ATTEMPT).find((o) => o.purposeId === "role-status-report")?.state).toBe("not-run");
});

test("rows are derived from purpose observations", () => {
	const observations = [...rolePurposeObservations(STRONG_ATTEMPT), ...clearPurposeObservations({ attempted: false })];
	const rows = deriveRows(observations);
	expect(rows).toHaveLength(13);
	for (const row of rows) {
		const observation = observations.find((entry) => entry.feature === row.feature && entry.purposeId === row.id);
		// A row never disagrees with its purpose observation, and never carries a state on its own.
		expect(row.state).toBe(observation?.state ?? "not-run");
		expect(row.purpose).toBe(observation?.purpose ?? row.purpose);
	}
	expect(rows.filter((row) => row.state === "not-run")).toHaveLength(12);
	validateMatrix(rows);
});

test("every observed row names the alternative and the difference", () => {
	const observations = [
		...rolePurposeObservations(STRONG_ATTEMPT),
		...modelPurposeObservations({ attempted: true, requestedLevel: "high", observedLevel: "high", roleModelSaved: true }),
		...clearPurposeObservations({
			attempted: true,
			before: { sessionId: "s-1", messageEntries: 4, todoEntries: 1 },
			after: { sessionId: "s-1", messageEntries: 5, todoEntries: 1 },
			context: { observed: true, cleared: true, detail: "only the later turn was in the request" },
		}),
	];
	const rows = deriveRows(observations);
	for (const row of rows.filter((entry) => entry.state !== "not-run")) {
		expect(row.alternative, row.id).toBeTruthy();
		expect(row.difference, row.id).toBeTruthy();
	}
	expect(() => validateMatrix(rows)).not.toThrow();
	// An observed row that lost its alternative is the failure the rule exists for: the reader would
	// see `available` and take it for pi's own surface.
	const stripped = rows.map((row) => (row.state === "not-run" ? row : { ...row, alternative: undefined }));
	expect(() => validateMatrix(stripped)).toThrow();
});

test("a limited row has to name a difference the user sees", () => {
	const rows = deriveRows([]).map((row) =>
		row.feature === "clear" ? { ...row, state: "limited" as const, alternative: "a command", difference: "None" } : row,
	);
	expect(() => validateMatrix(rows)).toThrow();
	// The same row with a visible difference is a legitimate `limited`.
	const named = rows.map((row) => (row.feature === "clear" ? { ...row, difference: "The chat display keeps the messages" } : row));
	expect(() => validateMatrix(named)).not.toThrow();
});

test("an observed purpose detail names the alternative it used", () => {
	const observations = rolePurposeObservations(STRONG_ATTEMPT);
	expect(() => validatePurposeObservations(observations)).not.toThrow();
	const routed = observations.find((observation) => observation.purposeId === "skill-strong-phase")!;
	expect(routed.detail).toContain("alternative");
	// `not-run` records a gap in the harness, so naming an alternative would claim a measurement.
	const gap = observations.find((observation) => observation.purposeId === "role-badge")!;
	expect(gap.state).toBe("not-run");
	expect(gap.detail ?? "").not.toContain("alternative");
	const hidden = observations.map((observation) => ({ ...observation, detail: observation.detail?.replace("alternative", "") }));
	expect(() => validatePurposeObservations(hidden)).toThrow();
});

test("matrix validation requires alternatives for unavailable rows", () => {
	expect(() => validateMatrix(deriveRows([]))).not.toThrow();
	const rows = deriveRows([]).map((row) => (row.feature === "clear" ? { ...row, state: "unavailable" as const } : row));
	expect(() => validateMatrix(rows)).not.toThrow();
	const stripped = rows.map((row) => (row.feature === "clear" ? { ...row, alternative: undefined } : row));
	expect(() => validateMatrix(stripped)).toThrow();
});
