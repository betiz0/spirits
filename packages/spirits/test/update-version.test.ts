import { expect, test } from "bun:test";
import { decideUpdate } from "../src/update/version.ts";

test("replaces when the installed version is older", () => {
	expect(decideUpdate("0.2.0", "0.3.0", false)).toBe("replace");
	expect(decideUpdate("0.2.0", "0.3.0", true)).toBe("replace");
});

test("reports up to date for an equal version without --force", () => {
	expect(decideUpdate("0.3.0", "0.3.0", false)).toBe("up-to-date");
});

test("replaces an equal version with --force", () => {
	expect(decideUpdate("0.3.0", "0.3.0", true)).toBe("replace");
});

test("reports newer for a prerelease ahead of the latest stable", () => {
	expect(decideUpdate("0.4.0-rc.1", "0.3.0", false)).toBe("newer");
});

test("replaces a newer prerelease with --force", () => {
	expect(decideUpdate("0.4.0-rc.1", "0.3.0", true)).toBe("replace");
});

test("orders prereleases below their release", () => {
	expect(decideUpdate("0.3.0-rc.1", "0.3.0", false)).toBe("replace");
	expect(decideUpdate("0.3.0", "0.3.0-rc.1", false)).toBe("newer");
});
