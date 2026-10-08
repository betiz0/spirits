import { expect, test } from "bun:test";
import { checkBunVersion } from "../bin/bun-gate.ts";

test("rejects below 1.4.0", () => {
	const result = checkBunVersion("1.3.14", false);
	expect(result.decision).toBe("reject");
	if (result.decision !== "reject") {
		throw new Error("expected reject");
	}
	expect(result.message).toContain("1.4.0");
	expect(result.exitCode).not.toBe(0);
});

test("warns below 1.4.2", () => {
	const result = checkBunVersion("1.4.1", false);
	expect(result.decision).toBe("warn");
	if (result.decision !== "warn") {
		throw new Error("expected warn");
	}
	expect(result.message).toContain("1.4.2");
	expect(result.message).toContain("continuing");
});

test("skips gate when compiled", () => {
	expect(checkBunVersion("1.3.0", true)).toEqual({ decision: "pass" });
});

test("passes at the recommended version", () => {
	expect(checkBunVersion("1.4.2", false)).toEqual({ decision: "pass" });
});
