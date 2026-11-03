import { expect, test } from "bun:test";
import { applyProbeObservations, COMPAT_MATRIX, matrixRows, validateMatrix } from "../../../scripts/managed-pi-compat/matrix.ts";

test("role items are classified separately", () => {
	const rows = matrixRows("role");
	expect(rows).toHaveLength(3);
	expect(rows.every((row) => row.state === "limited" || row.state === "unavailable")).toBe(true);
	expect(rows.some((row) => row.state === "limited")).toBe(true);
	expect(rows.some((row) => row.state === "unavailable")).toBe(true);
});

test("clear items include the session-id difference", () => {
	const row = matrixRows("clear")[0]!;
	expect(row.difference).toContain("new file/ID");
});

test("model items separate level from role", () => {
	const rows = matrixRows("model");
	expect(rows[0]?.purpose).toContain("thinking level");
	expect(rows[1]?.purpose).toContain("role");
});

test("matrix validation requires alternatives for unavailable rows", () => {
	expect(() => validateMatrix()).not.toThrow();
});

test("probe observations override the static matrix", () => {
	const row = COMPAT_MATRIX.find((entry) => entry.feature === "role")!;
	const updated = applyProbeObservations(
		[{ feature: "role", purpose: row.purpose, state: "available", detail: "observed on managed Pi" }],
		COMPAT_MATRIX,
	);
	expect(updated.find((entry) => entry.feature === "role" && entry.purpose === row.purpose)?.state).toBe("available");
});
