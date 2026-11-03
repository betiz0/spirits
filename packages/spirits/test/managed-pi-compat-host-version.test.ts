import { expect, test } from "bun:test";
import { classifyHostVersion } from "../../../scripts/managed-pi-compat/probes.ts";

test("host version matches the artifact", () => {
	expect(classifyHostVersion("1.5.0", "1.5.0")).toEqual({
		state: "confirmed",
		detail: "host version matches the artifact",
	});
});

test("bundled sdk version is not reported", () => {
	const result = classifyHostVersion("1.1.0", "1.5.0");
	expect(result.state).toBe("failed");
	expect(result.detail).toContain("1.1.0");
});
