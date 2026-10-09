import { expect, test } from "bun:test";
import { VERSION_FLAGS, formatVersionLine, isCompiledRun, resolveSpiritsVersion } from "../bin/version.ts";

test("isCompiledRun is false for an uncompiled run", () => {
	expect(isCompiledRun()).toBe(false);
});

test("resolveSpiritsVersion falls back to the dev version when uncompiled", () => {
	expect(resolveSpiritsVersion()).toBe("0.0.0-dev");
});

test("formatVersionLine uses the documented format", () => {
	expect(formatVersionLine("0.1.0", "1.4.2")).toBe("spirits 0.1.0 (Bun 1.4.2)");
});

test("VERSION_FLAGS covers both documented flags", () => {
	expect(VERSION_FLAGS.size).toBe(2);
	expect(VERSION_FLAGS.has("--version")).toBe(true);
	expect(VERSION_FLAGS.has("-v")).toBe(true);
});
