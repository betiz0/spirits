import { expect, test } from "bun:test";
import { classifyExtensionLoad, classifyHelpOnly } from "../../../scripts/managed-pi-compat/probes.ts";

test("loads the extension after session start", () => {
	expect(classifyExtensionLoad({ sessionStarted: true, tools: ["tsrepl", "manage_todos"] })).toEqual({
		state: "confirmed",
		detail: "session started and tsrepl is registered",
	});
	expect(classifyExtensionLoad({ sessionStarted: true, tools: [] }).state).toBe("unavailable");
});

test("help exit zero is not a load pass", () => {
	const result = classifyHelpOnly(0);
	expect(result.state).toBe("failed");
	expect(result.detail).toContain("does not prove");
});
